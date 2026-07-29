-- Amplia endereços para todas as UFs sem remover tabelas, colunas ou dados.
-- Rollback:
-- 1. Confirme que não existem endereços fora de SP.
-- 2. Restaure public.create_customer_order a partir de 20260727175000_sandbox_integrations.sql.
-- 3. Remova addresses_state_br_uf_check e recrie addresses_state_check com check (state = 'SP').

alter table public.addresses
  drop constraint if exists addresses_state_check;

alter table public.addresses
  add constraint addresses_state_br_uf_check check (
    state in (
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
      'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
      'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
    )
  );

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
  address_state text := upper(coalesce(address_data ->> 'state', ''));
begin
  if current_user_id is null then raise exception 'authentication_required'; end if;
  if requested_delivery_choice not in ('local_delivery_review', 'shipping_quote') then
    raise exception 'invalid_delivery_choice';
  end if;
  if jsonb_array_length(cart_items) = 0 then raise exception 'empty_cart'; end if;
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

revoke all on function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid)
  from public, anon;
grant execute on function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid)
  to authenticated;
