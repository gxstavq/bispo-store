-- Integrações exclusivamente Sandbox: Melhor Envio OAuth2 e Checkout PagBank.
-- Tokens são cifrados pela aplicação antes de chegar ao banco.

alter table public.shipping_quotes
  alter column order_id drop not null,
  add column if not exists customer_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists provider_quote_id text,
  add column if not exists carrier_name text,
  add column if not exists service_id text,
  add column if not exists delivery_days integer check (delivery_days is null or delivery_days >= 0),
  add column if not exists destination_postal_code text,
  add column if not exists quote_fingerprint text,
  add column if not exists cart_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb,
  add column if not exists expires_at timestamptz,
  add column if not exists selected_at timestamptz,
  add column if not exists error_message text;

create index if not exists shipping_quotes_customer_idx
  on public.shipping_quotes(customer_user_id, expires_at desc);

alter table public.orders
  add column if not exists selected_shipping_quote_id uuid references public.shipping_quotes(id),
  add column if not exists invoice_key text,
  add column if not exists stock_deducted_at timestamptz,
  add column if not exists stock_deduction_error text;

alter table public.payments
  add column if not exists checkout_id text unique,
  add column if not exists payment_url text,
  add column if not exists payment_method text,
  add column if not exists raw_status text,
  add column if not exists idempotency_key text unique,
  add column if not exists expires_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists last_error text;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (
  status in (
    'not_generated', 'creating', 'pending', 'paid', 'declined',
    'expired', 'cancelled', 'refunded', 'creation_failed', 'creation_uncertain'
  )
);

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (
  payment_status in (
    'not_generated', 'awaiting_payment', 'paid', 'declined',
    'expired', 'cancelled'
  )
);

alter table public.payment_events
  add column if not exists provider text not null default 'pagbank',
  add column if not exists provider_event_id text,
  add column if not exists provider_status text,
  add column if not exists verified boolean not null default false,
  add column if not exists verification_error text;

create unique index if not exists payment_events_provider_event_uidx
  on public.payment_events(provider, provider_event_id)
  where provider_event_id is not null;

alter table public.shipment_labels
  add column if not exists melhor_envio_order_id text,
  add column if not exists service_id text,
  add column if not exists carrier_name text,
  add column if not exists service_name text,
  add column if not exists purchase_idempotency_key text unique,
  add column if not exists print_url text,
  add column if not exists purchased_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists last_tracked_at timestamptz,
  add column if not exists last_error text,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb;

alter table public.shipment_labels drop constraint if exists shipment_labels_status_check;
alter table public.shipment_labels add constraint shipment_labels_status_check check (
  status in ('pending', 'in_cart', 'purchased', 'generated', 'printed', 'shipped', 'delivered', 'error', 'cancelled')
);

create unique index if not exists shipment_labels_order_provider_uidx
  on public.shipment_labels(order_id, provider);
create unique index if not exists shipment_labels_melhor_envio_uidx
  on public.shipment_labels(melhor_envio_order_id)
  where melhor_envio_order_id is not null;

alter table public.store_settings
  add column if not exists state_registration text,
  add column if not exists economic_activity_code text,
  add column if not exists fiscal_notes text,
  add column if not exists origin_district text,
  add column if not exists origin_city text not null default 'São Paulo',
  add column if not exists origin_state text not null default 'SP',
  add column if not exists sender_phone text;

create table if not exists public.integration_credentials (
  provider text primary key check (provider in ('melhor_envio')),
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  token_type text not null default 'Bearer',
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  connected_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oauth_states (
  state_hash text primary key,
  provider text not null check (provider = 'melhor_envio'),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_errors (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('melhor_envio', 'pagbank')),
  operation text not null,
  order_id uuid references public.orders(id) on delete set null,
  retryable boolean not null default false,
  error_code text,
  error_message text not null,
  safe_context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger integration_credentials_updated_at
before update on public.integration_credentials
for each row execute function private.touch_updated_at();

alter table public.integration_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.integration_errors enable row level security;

-- Credenciais e estados OAuth não possuem políticas: somente service role.
create policy integration_errors_admin_read on public.integration_errors
for select to authenticated using ((select private.is_admin()));

grant select on public.integration_errors to authenticated;
revoke all on public.integration_credentials from anon, authenticated;
revoke all on public.oauth_states from anon, authenticated;

drop policy if exists shipping_quotes_own_read on public.shipping_quotes;
create policy shipping_quotes_own_read on public.shipping_quotes
for select to authenticated using (
  customer_user_id = (select auth.uid())
  or order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);

create trigger shipment_labels_audit
after insert or update or delete on public.shipment_labels
for each row execute function private.capture_audit_log();

drop function if exists public.create_customer_order(jsonb, jsonb, jsonb, text, text);

create or replace function public.create_customer_order(
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
  current_user_id uuid := auth.uid();
  customer_record public.customers;
  address_record public.addresses;
  order_record public.orders;
  quote_record public.shipping_quotes;
  quote_item jsonb;
  item jsonb;
  product_record public.products;
  variant_record public.product_variants;
  item_quantity integer;
  calculated_subtotal numeric(12,2) := 0;
  unit_price numeric(12,2);
  generated_number text;
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if requested_delivery_choice not in ('local_delivery_review', 'shipping_quote') then
    raise exception 'invalid_delivery_choice';
  end if;
  if jsonb_array_length(cart_items) = 0 then raise exception 'empty_cart'; end if;
  if address_data ->> 'state' is distinct from 'SP' then raise exception 'invalid_state'; end if;

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
    'SP',
    nullif(address_data ->> 'reference', '')
  ) returning * into address_record;

  generated_number := 'BSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders(
    order_number, customer_id, address_id, status, delivery_choice,
    subtotal, shipping_amount, payment_status, shipping_status, notes,
    selected_shipping_quote_id
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
    selected_shipping_quote_id
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
    values (order_record.id, 'conventional_selected', 'Cotação Melhor Envio selecionada pelo cliente.', current_user_id);
  end if;

  return query select generated_number;
end;
$$;

revoke all on function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid) to authenticated;

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
    update public.orders set payment_status = 'paid', status = 'paid' where id = order_record.id;
    if order_record.stock_deducted_at is null then
      select exists (
        select 1
        from (
          select variant_id, sum(quantity)::integer as quantity
          from public.order_items where order_id = order_record.id group by variant_id
        ) items
        join public.product_variants variants on variants.id = items.variant_id
        where variants.stock < items.quantity
      ) into insufficient;

      if insufficient then
        update public.orders
        set stock_deduction_error = 'Estoque insuficiente no momento da confirmação PagBank.'
        where id = order_record.id;
        update public.payments
        set last_error = 'Pagamento confirmado, mas o estoque não pôde ser reduzido.'
        where id = payment_record.id;
      else
        update public.product_variants variants
        set stock = variants.stock - items.quantity
        from (
          select variant_id, sum(quantity)::integer as quantity
          from public.order_items where order_id = order_record.id group by variant_id
        ) items
        where variants.id = items.variant_id;
        update public.orders
        set stock_deducted_at = now(), stock_deduction_error = null
        where id = order_record.id;
      end if;
    end if;
  elsif confirmed_status = 'declined' then
    update public.orders set payment_status = 'declined' where id = order_record.id;
  elsif confirmed_status = 'expired' then
    update public.orders set payment_status = 'expired' where id = order_record.id;
  elsif confirmed_status = 'cancelled' then
    update public.orders set payment_status = 'cancelled' where id = order_record.id;
  else
    update public.orders set payment_status = 'awaiting_payment' where id = order_record.id;
  end if;

  return query
  select payment_record.id, order_record.id,
    (select stock_deducted_at is not null from public.orders where id = order_record.id),
    (select stock_deduction_error from public.orders where id = order_record.id);
end;
$$;

revoke all on function public.confirm_pagbank_payment(text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_pagbank_payment(text, text, text, text) to service_role;
