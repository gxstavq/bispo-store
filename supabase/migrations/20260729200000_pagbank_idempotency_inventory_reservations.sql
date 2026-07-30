-- PagBank Sandbox: idempotência de pedidos, IN_ANALYSIS e reservas concorrentes.
-- Migration aditiva e retrocompatível com a versão publicada em 2026-07-29.

begin;

alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists idempotency_fingerprint text;

create unique index if not exists orders_customer_idempotency_uidx
  on public.orders(customer_id, idempotency_key)
  where idempotency_key is not null;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (
  status in (
    'not_generated', 'creating', 'pending', 'in_analysis', 'paid', 'declined',
    'expired', 'cancelled', 'refunded', 'creation_failed', 'creation_uncertain'
  )
);

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (
  payment_status in (
    'not_generated', 'awaiting_payment', 'in_analysis', 'paid', 'declined',
    'expired', 'cancelled'
  )
);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  status text not null default 'active'
    check (status in ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz not null,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, variant_id)
);

create index if not exists inventory_reservations_variant_active_idx
  on public.inventory_reservations(variant_id, expires_at)
  where status = 'active';

create index if not exists inventory_reservations_order_idx
  on public.inventory_reservations(order_id, status);

alter table public.inventory_reservations enable row level security;
revoke all on public.inventory_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_reservations to service_role;

create or replace function public.reserve_order_stock(
  target_order_id uuid,
  reservation_expires_at timestamptz
)
returns table(expires_at timestamptz, reserved_items integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_record public.orders;
  item_record record;
  variant_stock integer;
  already_reserved integer;
  item_count integer := 0;
begin
  if reservation_expires_at <= now()
    or reservation_expires_at > now() + interval '125 minutes'
  then
    raise exception 'invalid_reservation_expiration';
  end if;

  select * into order_record
  from public.orders
  where id = target_order_id
  for update;

  if order_record.id is null then raise exception 'order_not_found'; end if;
  if order_record.payment_status in ('paid', 'declined', 'expired', 'cancelled')
    or order_record.status = 'cancelled'
  then
    raise exception 'order_not_reservable';
  end if;

  for item_record in
    select variant_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = target_order_id
    group by variant_id
    order by variant_id
  loop
    if item_record.variant_id is null then raise exception 'variant_unavailable'; end if;

    select stock into variant_stock
    from public.product_variants
    where id = item_record.variant_id and active = true
    for update;

    if variant_stock is null then raise exception 'variant_unavailable'; end if;

    update public.inventory_reservations
    set status = 'expired',
        release_reason = 'reservation_expired',
        updated_at = now()
    where variant_id = item_record.variant_id
      and status = 'active'
      and expires_at <= now();

    select coalesce(sum(quantity), 0)::integer into already_reserved
    from public.inventory_reservations
    where variant_id = item_record.variant_id
      and order_id <> target_order_id
      and status = 'active'
      and expires_at > now();

    if variant_stock - already_reserved < item_record.quantity then
      raise exception 'insufficient_available_stock';
    end if;

    insert into public.inventory_reservations(
      order_id, variant_id, quantity, status, expires_at,
      release_reason, created_at, updated_at
    )
    values (
      target_order_id, item_record.variant_id, item_record.quantity,
      'active', reservation_expires_at, null, now(), now()
    )
    on conflict (order_id, variant_id) do update set
      quantity = excluded.quantity,
      status = 'active',
      expires_at = excluded.expires_at,
      release_reason = null,
      updated_at = now();

    item_count := item_count + 1;
  end loop;

  if item_count = 0 then raise exception 'order_without_items'; end if;
  return query select reservation_expires_at, item_count;
end;
$$;

revoke all on function public.reserve_order_stock(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_order_stock(uuid, timestamptz)
  to service_role;

create or replace function public.release_order_stock_reservation(
  target_order_id uuid,
  requested_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
begin
  update public.inventory_reservations
  set status = case
      when expires_at <= now() then 'expired'
        else 'released'
      end,
      release_reason = left(coalesce(requested_reason, 'released'), 200),
      updated_at = now()
  where order_id = target_order_id and status = 'active';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.release_order_stock_reservation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_order_stock_reservation(uuid, text)
  to service_role;

create or replace function private.release_terminal_order_reservations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'cancelled'
    or new.payment_status in ('declined', 'expired', 'cancelled')
  then
    update public.inventory_reservations
    set status = case
          when expires_at <= now() then 'expired'
          else 'released'
        end,
        release_reason = case
          when new.status = 'cancelled' then 'order_cancelled'
          else 'payment_' || new.payment_status
        end,
        updated_at = now()
    where order_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_release_terminal_reservations on public.orders;
create trigger orders_release_terminal_reservations
after update of status, payment_status on public.orders
for each row execute function private.release_terminal_order_reservations();

-- Nova assinatura. A assinatura antiga de seis argumentos permanece disponível
-- para que o deploy atual continue funcionando caso esta migration seja aplicada
-- antes da próxima versão da aplicação.
create or replace function public.create_customer_order(
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
as $$
declare
  current_user_id uuid := auth.uid();
  customer_record public.customers;
  address_record public.addresses;
  order_record public.orders;
  existing_order public.orders;
  quote_record public.shipping_quotes;
  quote_item jsonb;
  item jsonb;
  product_record public.products;
  variant_record public.product_variants;
  item_quantity integer;
  calculated_subtotal numeric(12,2) := 0;
  unit_price numeric(12,2);
  generated_number text;
  address_state text := upper(coalesce(address_data ->> 'state', ''));
  request_fingerprint text;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if requested_idempotency_key is null
    or requested_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid_idempotency_key';
  end if;

  request_fingerprint := md5(jsonb_build_object(
    'customer', customer_data,
    'address', address_data,
    'items', cart_items,
    'delivery_choice', requested_delivery_choice,
    'notes', order_notes,
    'shipping_quote_id', selected_shipping_quote_id
  )::text);

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || requested_idempotency_key, 0)
  );

  select orders.* into existing_order
  from public.orders
  join public.customers on customers.id = orders.customer_id
  where customers.user_id = current_user_id
    and orders.idempotency_key = requested_idempotency_key
  limit 1;

  if existing_order.id is not null then
    if existing_order.idempotency_fingerprint is distinct from request_fingerprint then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;
    return query select existing_order.order_number;
    return;
  end if;

  if requested_delivery_choice not in ('local_delivery_review', 'shipping_quote') then
    raise exception 'invalid_delivery_choice';
  end if;
  if jsonb_typeof(cart_items) <> 'array' then
    raise exception 'invalid_cart';
  end if;
  if jsonb_array_length(cart_items) = 0 then
    raise exception 'empty_cart';
  end if;
  if address_state <> all(array[
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
    'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
    'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ]) then
    raise exception 'invalid_state';
  end if;
  if requested_delivery_choice = 'local_delivery_review' and address_state <> 'SP' then
    raise exception 'local_delivery_unavailable_for_state';
  end if;

  if requested_delivery_choice = 'shipping_quote' then
    if selected_shipping_quote_id is null then raise exception 'shipping_quote_required'; end if;
    select * into quote_record
    from public.shipping_quotes
    where id = selected_shipping_quote_id
      and provider = 'melhor_envio'
      and customer_user_id = current_user_id
      and selected = false
      and order_id is null
      and expires_at > now()
      and regexp_replace(destination_postal_code, '\D', '', 'g')
        = regexp_replace(address_data ->> 'postal_code', '\D', '', 'g')
    for update;
    if quote_record.id is null then raise exception 'shipping_quote_invalid_or_expired'; end if;
    if jsonb_array_length(quote_record.cart_snapshot) <> jsonb_array_length(cart_items) then
      raise exception 'shipping_quote_cart_changed';
    end if;
  elsif selected_shipping_quote_id is not null then
    raise exception 'shipping_quote_not_allowed_for_local_delivery';
  end if;

  insert into public.customers(user_id, full_name, whatsapp, email)
  values (
    current_user_id,
    customer_data ->> 'full_name',
    customer_data ->> 'whatsapp',
    coalesce(auth.jwt() ->> 'email', customer_data ->> 'email')
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    whatsapp = excluded.whatsapp,
    email = excluded.email,
    updated_at = now()
  returning * into customer_record;

  insert into public.addresses(
    customer_id, postal_code, street, number, complement,
    district, city, state, reference
  ) values (
    customer_record.id,
    address_data ->> 'postal_code',
    address_data ->> 'street',
    address_data ->> 'number',
    nullif(address_data ->> 'complement', ''),
    address_data ->> 'district',
    address_data ->> 'city',
    address_state,
    nullif(address_data ->> 'reference', '')
  ) returning * into address_record;

  generated_number := 'BSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders(
    order_number, customer_id, address_id, status, delivery_choice,
    subtotal, shipping_amount, payment_status, shipping_status, notes,
    selected_shipping_quote_id, idempotency_key, idempotency_fingerprint
  ) values (
    generated_number,
    customer_record.id,
    address_record.id,
    case when requested_delivery_choice = 'local_delivery_review'
      then 'awaiting_local_delivery_review'
      else 'awaiting_payment'
    end,
    requested_delivery_choice,
    0,
    case when requested_delivery_choice = 'shipping_quote' then quote_record.amount else null end,
    'not_generated',
    case when requested_delivery_choice = 'local_delivery_review'
      then 'awaiting_review'
      else 'selected'
    end,
    order_notes,
    selected_shipping_quote_id,
    requested_idempotency_key,
    request_fingerprint
  ) returning * into order_record;

  for item in select * from jsonb_array_elements(cart_items)
  loop
    item_quantity := greatest(1, (item ->> 'quantity')::integer);
    select * into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid
      and status = 'active' and deleted_at is null and shipping_enabled = true;
    if product_record.id is null then raise exception 'product_unavailable'; end if;

    select * into variant_record
    from public.product_variants
    where product_id = product_record.id
      and size = item ->> 'size'
      and color = item ->> 'color'
      and active = true
    limit 1;
    if variant_record.id is null or variant_record.stock < item_quantity then
      raise exception 'variant_unavailable';
    end if;

    unit_price := coalesce(product_record.promotional_price, product_record.price);
    if requested_delivery_choice = 'shipping_quote' then
      select value into quote_item
      from jsonb_array_elements(quote_record.cart_snapshot)
      where value ->> 'product_id' = product_record.id::text
        and value ->> 'size' = variant_record.size
        and value ->> 'color' = variant_record.color
        and (value ->> 'quantity')::integer = item_quantity
      limit 1;
      if quote_item is null
        or (quote_item ->> 'unit_price')::numeric is distinct from unit_price
        or (quote_item ->> 'weight_kg')::numeric is distinct from product_record.weight_kg
        or (quote_item ->> 'length_cm')::numeric is distinct from product_record.length_cm
        or (quote_item ->> 'width_cm')::numeric is distinct from product_record.width_cm
        or (quote_item ->> 'height_cm')::numeric is distinct from product_record.height_cm
      then
        raise exception 'shipping_quote_stale';
      end if;
    end if;

    calculated_subtotal := calculated_subtotal + (unit_price * item_quantity);
    insert into public.order_items(
      order_id, product_id, variant_id, product_snapshot, quantity, unit_price
    ) values (
      order_record.id, product_record.id, variant_record.id,
      jsonb_build_object(
        'name', product_record.name, 'code', product_record.code,
        'size', variant_record.size, 'color', variant_record.color
      ),
      item_quantity, unit_price
    );
  end loop;

  update public.orders set subtotal = calculated_subtotal where id = order_record.id;

  if requested_delivery_choice = 'shipping_quote' then
    update public.shipping_quotes
    set order_id = order_record.id, selected = true, selected_at = now()
    where id = quote_record.id;
    insert into public.shipping_decisions(order_id, decision, note, decided_by)
    values (
      order_record.id,
      'conventional_selected',
      'Cotação Melhor Envio selecionada pelo cliente.',
      current_user_id
    );
  end if;

  return query select generated_number;
end;
$$;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) to authenticated;

alter function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid, text)
  set statement_timeout = '5s';

create or replace function public.confirm_pagbank_payment(
  target_checkout_id text,
  confirmed_status text,
  confirmed_method text,
  provider_raw_status text
)
returns table(payment_id uuid, order_id uuid, stock_deducted boolean, stock_error text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_record public.payments;
  order_record public.orders;
  insufficient boolean := false;
begin
  if confirmed_status not in (
    'pending', 'in_analysis', 'paid', 'declined', 'expired', 'cancelled'
  ) then
    raise exception 'invalid_payment_status';
  end if;

  select * into payment_record from public.payments
  where checkout_id = target_checkout_id for update;
  if payment_record.id is null then raise exception 'payment_not_found'; end if;

  select * into order_record from public.orders
  where id = payment_record.order_id for update;

  update public.payments
  set status = confirmed_status,
      payment_method = coalesce(confirmed_method, payment_method),
      raw_status = provider_raw_status,
      confirmed_at = case when confirmed_status = 'paid' then now() else confirmed_at end,
      updated_at = now()
  where id = payment_record.id;

  if confirmed_status = 'paid' then
    update public.orders
    set payment_status = 'paid', status = 'paid'
    where id = order_record.id;

    if order_record.stock_deducted_at is null then
      perform variants.id
      from public.product_variants variants
      join (
        select variant_id
        from public.order_items
        where order_id = order_record.id
        group by variant_id
      ) items on items.variant_id = variants.id
      order by variants.id
      for update;

      select exists (
        select 1
        from (
          select variant_id, sum(quantity)::integer as quantity
          from public.order_items
          where order_id = order_record.id
          group by variant_id
        ) items
        left join public.product_variants variants on variants.id = items.variant_id
        where variants.id is null
          or variants.stock - coalesce((
            select sum(reservations.quantity)
            from public.inventory_reservations reservations
            where reservations.variant_id = items.variant_id
              and reservations.order_id <> order_record.id
              and reservations.status = 'active'
              and reservations.expires_at > now()
          ), 0) < items.quantity
      ) into insufficient;

      if insufficient then
        update public.orders
        set stock_deduction_error = 'Estoque insuficiente no momento da confirmação PagBank.'
        where id = order_record.id;
        update public.payments
        set last_error = 'Pagamento confirmado, mas o estoque não pôde ser reduzido.'
        where id = payment_record.id;
        update public.inventory_reservations
        set status = 'released',
            release_reason = 'insufficient_stock_after_payment',
            updated_at = now()
        where order_id = order_record.id and status = 'active';
      else
        update public.product_variants variants
        set stock = variants.stock - items.quantity
        from (
          select variant_id, sum(quantity)::integer as quantity
          from public.order_items
          where order_id = order_record.id
          group by variant_id
        ) items
        where variants.id = items.variant_id;

        update public.orders
        set stock_deducted_at = now(), stock_deduction_error = null
        where id = order_record.id;

        update public.inventory_reservations
        set status = 'consumed',
            release_reason = 'payment_confirmed',
            updated_at = now()
        where order_id = order_record.id and status = 'active';
      end if;
    end if;
  elsif confirmed_status = 'in_analysis' then
    update public.orders set payment_status = 'in_analysis'
    where id = order_record.id;
    update public.inventory_reservations
    set expires_at = greatest(expires_at, now() + interval '2 hours'),
        updated_at = now()
    where order_id = order_record.id and status = 'active';
  elsif confirmed_status = 'declined' then
    update public.orders set payment_status = 'declined'
    where id = order_record.id;
  elsif confirmed_status = 'expired' then
    update public.orders set payment_status = 'expired'
    where id = order_record.id;
  elsif confirmed_status = 'cancelled' then
    update public.orders set payment_status = 'cancelled'
    where id = order_record.id;
  else
    update public.orders set payment_status = 'awaiting_payment'
    where id = order_record.id;
  end if;

  return query
  select payment_record.id, order_record.id,
    (select stock_deducted_at is not null from public.orders where id = order_record.id),
    (select stock_deduction_error from public.orders where id = order_record.id);
end;
$$;

revoke all on function public.confirm_pagbank_payment(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_pagbank_payment(text, text, text, text)
  to service_role;

commit;
