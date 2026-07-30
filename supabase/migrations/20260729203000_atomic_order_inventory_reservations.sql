-- Correção incremental: reserva atômica durante a criação do pedido.
-- Não remove dados nem altera as assinaturas públicas existentes.

begin;

-- Corrige SQLSTATE 42702: `expires_at` também é o nome de uma coluna de saída
-- PL/pgSQL. Todas as referências da tabela passam a ser qualificadas.
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
    raise exception using
      errcode = 'P0001',
      message = 'invalid_reservation_expiration';
  end if;

  select orders.* into order_record
  from public.orders as orders
  where orders.id = target_order_id
  for update;

  if order_record.id is null then
    raise exception using errcode = 'P0001', message = 'order_not_found';
  end if;
  if order_record.payment_status in ('paid', 'declined', 'expired', 'cancelled')
    or order_record.status = 'cancelled'
  then
    raise exception using errcode = 'P0001', message = 'order_not_reservable';
  end if;

  -- A ordenação é obrigatória: todos os carrinhos adquirem locks das variantes
  -- na mesma ordem, independentemente da ordem recebida no JSON.
  for item_record in
    select items.variant_id, sum(items.quantity)::integer as quantity
    from public.order_items as items
    where items.order_id = target_order_id
    group by items.variant_id
    order by items.variant_id
  loop
    if item_record.variant_id is null then
      raise exception using errcode = 'P0001', message = 'variant_unavailable';
    end if;

    -- O row lock é mantido até o commit/rollback da transação externa.
    select variants.stock into variant_stock
    from public.product_variants as variants
    where variants.id = item_record.variant_id
      and variants.active = true
    for update;

    if variant_stock is null then
      raise exception using errcode = 'P0001', message = 'variant_unavailable';
    end if;

    update public.inventory_reservations as reservations
    set status = 'expired',
        release_reason = 'reservation_expired',
        updated_at = now()
    where reservations.variant_id = item_record.variant_id
      and reservations.status = 'active'
      and reservations.expires_at <= now();

    select coalesce(sum(reservations.quantity), 0)::integer
      into already_reserved
    from public.inventory_reservations as reservations
    where reservations.variant_id = item_record.variant_id
      and reservations.order_id <> target_order_id
      and reservations.status = 'active'
      and reservations.expires_at > now();

    if variant_stock - already_reserved < item_record.quantity then
      raise exception using
        errcode = 'P0001',
        message = 'insufficient_available_stock',
        detail = format(
          'variant_id=%s stock=%s reserved=%s requested=%s',
          item_record.variant_id,
          variant_stock,
          already_reserved,
          item_record.quantity
        );
    end if;

    insert into public.inventory_reservations as reservations (
      order_id,
      variant_id,
      quantity,
      status,
      expires_at,
      release_reason,
      created_at,
      updated_at
    )
    values (
      target_order_id,
      item_record.variant_id,
      item_record.quantity,
      'active',
      reservation_expires_at,
      null,
      now(),
      now()
    )
    on conflict (order_id, variant_id) do update set
      quantity = excluded.quantity,
      status = 'active',
      expires_at = excluded.expires_at,
      release_reason = null,
      updated_at = now();

    item_count := item_count + 1;
  end loop;

  if item_count = 0 then
    raise exception using errcode = 'P0001', message = 'order_without_items';
  end if;

  return query select reservation_expires_at, item_count;
end;
$$;

revoke all on function public.reserve_order_stock(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_order_stock(uuid, timestamptz)
  to service_role;
alter function public.reserve_order_stock(uuid, timestamptz)
  set lock_timeout = '5s';

-- Preserva os corpos atualmente publicados sob nomes privados. Os wrappers
-- públicos abaixo mantêm as assinaturas e tornam criação + reserva uma única
-- transação Postgres. Se a reserva falhar, todos os inserts internos voltam.
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set schema private;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) rename to create_customer_order_unreserved_idempotent;

revoke all on function private.create_customer_order_unreserved_idempotent(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon, authenticated;

alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set schema private;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) rename to create_customer_order_unreserved_legacy;

revoke all on function private.create_customer_order_unreserved_legacy(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;

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
as $$
declare
  generated_number text;
  generated_order_id uuid;
  existing_order_id uuid;
begin
  select orders.id into existing_order_id
  from public.orders as orders
  join public.customers as customers on customers.id = orders.customer_id
  where customers.user_id = auth.uid()
    and orders.idempotency_key = requested_idempotency_key
  limit 1;

  select created.order_number into generated_number
  from private.create_customer_order_unreserved_idempotent(
    customer_data,
    address_data,
    cart_items,
    requested_delivery_choice,
    order_notes,
    selected_shipping_quote_id,
    requested_idempotency_key
  ) as created;

  select orders.id into generated_order_id
  from public.orders as orders
  join public.customers as customers on customers.id = orders.customer_id
  where orders.order_number = generated_number
    and customers.user_id = auth.uid();

  if generated_order_id is null then
    raise exception using errcode = 'P0001', message = 'created_order_not_found';
  end if;

  -- O corpo preservado ainda valida o fingerprint. Depois dessa validação,
  -- uma repetição de pedido já existente deve apenas retornar o mesmo número,
  -- inclusive se o pagamento já estiver em estado terminal.
  if existing_order_id is not null then
    return query select generated_number;
    return;
  end if;

  -- Repetições da mesma chave podem encontrar a reserva já criada. A função
  -- é idempotente por (order_id, variant_id) e mantém uma única reserva.
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
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set statement_timeout = '15s';

-- A assinatura antiga permanece disponível para a versão atualmente publicada.
-- Ela continua sem idempotência explícita, mas passa a criar pedido e reserva
-- atomicamente dentro da mesma chamada.
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
as $$
declare
  generated_number text;
  generated_order_id uuid;
begin
  select created.order_number into generated_number
  from private.create_customer_order_unreserved_legacy(
    customer_data,
    address_data,
    cart_items,
    requested_delivery_choice,
    order_notes,
    selected_shipping_quote_id
  ) as created;

  select orders.id into generated_order_id
  from public.orders as orders
  join public.customers as customers on customers.id = orders.customer_id
  where orders.order_number = generated_number
    and customers.user_id = auth.uid();

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
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set statement_timeout = '15s';

commit;
