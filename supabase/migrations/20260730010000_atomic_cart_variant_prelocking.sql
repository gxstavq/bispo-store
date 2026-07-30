-- Elimina o upgrade circular de locks entre a inserção de order_items e a
-- reserva de estoque. As variantes são bloqueadas e validadas antes de
-- qualquer escrita do pedido, sempre na ordem determinística do UUID.

begin;

create function private.lock_and_validate_cart_inventory(cart_items jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $$
declare
  requested_groups integer := 0;
  locked_groups integer := 0;
  requested_item record;
  already_reserved integer := 0;
begin
  if jsonb_typeof(cart_items) <> 'array'
    or jsonb_array_length(cart_items) = 0
  then
    raise exception using errcode = 'P0001', message = 'invalid_cart';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(cart_items) as raw_items(
      product_id text,
      size text,
      color text,
      quantity text
    )
    where raw_items.product_id is null
      or raw_items.product_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(raw_items.size), '') is null
      or nullif(btrim(raw_items.color), '') is null
      or coalesce(raw_items.quantity, '1') !~ '^[1-9][0-9]{0,5}$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_cart_item';
  end if;

  select count(*)::integer
    into requested_groups
  from (
    select
      raw_items.product_id::uuid as product_id,
      btrim(raw_items.size) as size,
      btrim(raw_items.color) as color
    from jsonb_to_recordset(cart_items) as raw_items(
      product_id text,
      size text,
      color text,
      quantity text
    )
    group by
      raw_items.product_id::uuid,
      btrim(raw_items.size),
      btrim(raw_items.color)
  ) as requested;

  -- Todos os row locks são adquiridos antes da criação de customer/address/
  -- order/order_items. Isso evita elevar KEY SHARE do FK para FOR UPDATE.
  perform variants.id
  from (
    select
      raw_items.product_id::uuid as product_id,
      btrim(raw_items.size) as size,
      btrim(raw_items.color) as color,
      sum(coalesce(raw_items.quantity, '1')::integer)::integer as quantity
    from jsonb_to_recordset(cart_items) as raw_items(
      product_id text,
      size text,
      color text,
      quantity text
    )
    group by
      raw_items.product_id::uuid,
      btrim(raw_items.size),
      btrim(raw_items.color)
  ) as requested
  join public.products as products
    on products.id = requested.product_id
   and products.status = 'active'
   and products.deleted_at is null
   and products.shipping_enabled = true
  join public.product_variants as variants
    on variants.product_id = requested.product_id
   and variants.size = requested.size
   and variants.color = requested.color
   and variants.active = true
  order by variants.id
  for update of variants;

  get diagnostics locked_groups = row_count;

  if locked_groups <> requested_groups then
    raise exception using errcode = 'P0001', message = 'variant_unavailable';
  end if;

  -- A disponibilidade é calculada somente depois que todos os UUIDs foram
  -- bloqueados. Reservas expiradas são liberadas sob a mesma ordem de locks.
  for requested_item in
    select
      variants.id as variant_id,
      variants.stock as stock,
      requested.quantity as quantity
    from (
      select
        raw_items.product_id::uuid as product_id,
        btrim(raw_items.size) as size,
        btrim(raw_items.color) as color,
        sum(coalesce(raw_items.quantity, '1')::integer)::integer as quantity
      from jsonb_to_recordset(cart_items) as raw_items(
        product_id text,
        size text,
        color text,
        quantity text
      )
      group by
        raw_items.product_id::uuid,
        btrim(raw_items.size),
        btrim(raw_items.color)
    ) as requested
    join public.product_variants as variants
      on variants.product_id = requested.product_id
     and variants.size = requested.size
     and variants.color = requested.color
     and variants.active = true
    order by variants.id
  loop
    update public.inventory_reservations as reservations
    set status = 'expired',
        release_reason = 'reservation_expired',
        updated_at = now()
    where reservations.variant_id = requested_item.variant_id
      and reservations.status = 'active'
      and reservations.expires_at <= now();

    select coalesce(sum(reservations.quantity), 0)::integer
      into already_reserved
    from public.inventory_reservations as reservations
    where reservations.variant_id = requested_item.variant_id
      and reservations.status = 'active'
      and reservations.expires_at > now();

    if requested_item.stock - already_reserved < requested_item.quantity then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_available_stock',
        detail = format(
          'variant_id=%s stock=%s reserved=%s requested=%s',
          requested_item.variant_id,
          requested_item.stock,
          already_reserved,
          requested_item.quantity
        );
    end if;
  end loop;
end;
$$;

revoke all on function private.lock_and_validate_cart_inventory(jsonb)
  from public, anon, authenticated, service_role;

-- Preserva os dois wrappers públicos atuais para rollback estrutural.
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set schema private;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) rename to create_customer_order_pre_20260730010000_idempotent;

revoke all on function private.create_customer_order_pre_20260730010000_idempotent(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon, authenticated, service_role;

alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set schema private;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) rename to create_customer_order_pre_20260730010000_legacy;

revoke all on function private.create_customer_order_pre_20260730010000_legacy(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated, service_role;

create function public.create_customer_order(
  customer_data jsonb,
  address_data jsonb,
  cart_items jsonb,
  requested_delivery_choice text,
  order_notes text,
  selected_shipping_quote_id uuid,
  requested_idempotency_key text
)
returns table(order_number text)
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
set statement_timeout = '15s'
as $$
declare
  current_user_id uuid := auth.uid();
  request_fingerprint text;
  existing_order public.orders;
  generated_number text;
  generated_order_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;
  if requested_idempotency_key is null
    or requested_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using errcode = 'P0001', message = 'invalid_idempotency_key';
  end if;

  request_fingerprint := md5(jsonb_build_object(
    'customer', customer_data,
    'address', address_data,
    'items', cart_items,
    'delivery_choice', requested_delivery_choice,
    'notes', order_notes,
    'shipping_quote_id', selected_shipping_quote_id
  )::text);

  -- A mesma chave é serializada antes da leitura de idempotência e antes dos
  -- row locks. A função privada preservada pode adquirir o mesmo lock novamente.
  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || requested_idempotency_key, 0)
  );

  select orders.*
    into existing_order
  from public.orders as orders
  join public.customers as customers
    on customers.id = orders.customer_id
  where customers.user_id = current_user_id
    and orders.idempotency_key = requested_idempotency_key
  limit 1;

  if existing_order.id is not null then
    if existing_order.idempotency_fingerprint is distinct from request_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'idempotency_key_reused_with_different_payload';
    end if;
    return query select existing_order.order_number;
    return;
  end if;

  perform private.lock_and_validate_cart_inventory(cart_items);

  select created.order_number
    into generated_number
  from private.create_customer_order_unreserved_idempotent(
    customer_data,
    address_data,
    cart_items,
    requested_delivery_choice,
    order_notes,
    selected_shipping_quote_id,
    requested_idempotency_key
  ) as created;

  select orders.id
    into generated_order_id
  from public.orders as orders
  join public.customers as customers
    on customers.id = orders.customer_id
  where orders.order_number = generated_number
    and customers.user_id = current_user_id;

  if generated_order_id is null then
    raise exception using errcode = 'P0001', message = 'created_order_not_found';
  end if;

  perform *
  from public.reserve_order_stock(
    generated_order_id,
    now() + interval '120 minutes'
  );

  return query select generated_number;
end;
$$;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) to authenticated;

create function public.create_customer_order(
  customer_data jsonb,
  address_data jsonb,
  cart_items jsonb,
  requested_delivery_choice text,
  order_notes text default null,
  selected_shipping_quote_id uuid default null
)
returns table(order_number text)
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
set statement_timeout = '15s'
as $$
declare
  current_user_id uuid := auth.uid();
  generated_number text;
  generated_order_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;

  perform private.lock_and_validate_cart_inventory(cart_items);

  select created.order_number
    into generated_number
  from private.create_customer_order_unreserved_legacy(
    customer_data,
    address_data,
    cart_items,
    requested_delivery_choice,
    order_notes,
    selected_shipping_quote_id
  ) as created;

  select orders.id
    into generated_order_id
  from public.orders as orders
  join public.customers as customers
    on customers.id = orders.customer_id
  where orders.order_number = generated_number
    and customers.user_id = current_user_id;

  if generated_order_id is null then
    raise exception using errcode = 'P0001', message = 'created_order_not_found';
  end if;

  perform *
  from public.reserve_order_stock(
    generated_order_id,
    now() + interval '120 minutes'
  );

  return query select generated_number;
end;
$$;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) to authenticated;

-- Atualizações administrativas de várias variantes passam a usar a mesma
-- ordem determinística, preservando UUIDs quando tamanho e cor permanecem.
create function public.replace_product_variants(
  target_product_id uuid,
  variants_data jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
set statement_timeout = '15s'
as $$
begin
  if auth.role() <> 'service_role' and not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if jsonb_typeof(variants_data) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_variants';
  end if;
  if not exists (
    select 1
    from public.products as products
    where products.id = target_product_id
  ) then
    raise exception using errcode = 'P0001', message = 'product_not_found';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(variants_data) as raw_variants(
      sku text,
      size text,
      color text,
      stock text,
      active boolean
    )
    where nullif(btrim(raw_variants.sku), '') is null
      or nullif(btrim(raw_variants.size), '') is null
      or nullif(btrim(raw_variants.color), '') is null
      or coalesce(raw_variants.stock, '') !~ '^[0-9]{1,9}$'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_variant';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(variants_data) as raw_variants(
      sku text,
      size text,
      color text,
      stock text,
      active boolean
    )
    group by btrim(raw_variants.size), btrim(raw_variants.color)
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate_variant';
  end if;

  perform variants.id
  from public.product_variants as variants
  where variants.product_id = target_product_id
  order by variants.id
  for update;

  insert into public.product_variants as variants (
    product_id,
    sku,
    size,
    color,
    stock,
    active
  )
  select
    target_product_id,
    btrim(raw_variants.sku),
    btrim(raw_variants.size),
    btrim(raw_variants.color),
    raw_variants.stock::integer,
    coalesce(raw_variants.active, true)
  from jsonb_to_recordset(variants_data) as raw_variants(
    sku text,
    size text,
    color text,
    stock text,
    active boolean
  )
  order by btrim(raw_variants.size), btrim(raw_variants.color)
  on conflict (product_id, size, color) do update
  set sku = excluded.sku,
      stock = excluded.stock,
      active = excluded.active,
      updated_at = now();

  delete from public.product_variants as variants
  where variants.product_id = target_product_id
    and not exists (
      select 1
      from jsonb_to_recordset(variants_data) as raw_variants(
        sku text,
        size text,
        color text,
        stock text,
        active boolean
      )
      where btrim(raw_variants.size) = variants.size
        and btrim(raw_variants.color) = variants.color
    );
end;
$$;

revoke all on function public.replace_product_variants(uuid, jsonb)
  from public, anon;
grant execute on function public.replace_product_variants(uuid, jsonb)
  to authenticated, service_role;

-- Pagamento usa a mesma janela de timeout de lock das demais mutações.
alter function public.confirm_pagbank_payment(text, text, text, text)
  set lock_timeout = '5s';
alter function public.confirm_pagbank_payment(text, text, text, text)
  set statement_timeout = '15s';

commit;
