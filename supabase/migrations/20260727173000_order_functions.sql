create or replace function public.create_customer_order(
  customer_data jsonb,
  address_data jsonb,
  cart_items jsonb,
  requested_delivery_choice text,
  order_notes text default null
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
  item jsonb;
  product_record public.products;
  variant_record public.product_variants;
  item_quantity integer;
  calculated_subtotal numeric(12,2) := 0;
  unit_price numeric(12,2);
  generated_number text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if requested_delivery_choice not in ('local_delivery_review', 'shipping_quote') then
    raise exception 'invalid_delivery_choice';
  end if;
  if jsonb_array_length(cart_items) = 0 then
    raise exception 'empty_cart';
  end if;
  if address_data ->> 'state' is distinct from 'SP' then
    raise exception 'invalid_state';
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
    subtotal, shipping_amount, payment_status, shipping_status, notes
  ) values (
    generated_number,
    customer_record.id,
    address_record.id,
    case when requested_delivery_choice = 'local_delivery_review'
      then 'awaiting_local_delivery_review'
      else 'awaiting_shipping_selection'
    end,
    requested_delivery_choice,
    0,
    null,
    'not_generated',
    case when requested_delivery_choice = 'local_delivery_review'
      then 'awaiting_review'
      else 'awaiting_selection'
    end,
    order_notes
  ) returning * into order_record;

  for item in select * from jsonb_array_elements(cart_items)
  loop
    item_quantity := greatest(1, (item ->> 'quantity')::integer);
    select * into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid
      and status = 'active'
      and deleted_at is null
      and shipping_enabled = true;
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
    calculated_subtotal := calculated_subtotal + (unit_price * item_quantity);
    insert into public.order_items(
      order_id, product_id, variant_id, product_snapshot, quantity, unit_price
    ) values (
      order_record.id,
      product_record.id,
      variant_record.id,
      jsonb_build_object(
        'name', product_record.name,
        'code', product_record.code,
        'size', variant_record.size,
        'color', variant_record.color
      ),
      item_quantity,
      unit_price
    );
  end loop;

  update public.orders
  set subtotal = calculated_subtotal
  where id = order_record.id;

  return query select generated_number;
end;
$$;

revoke all on function public.create_customer_order(jsonb, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.create_customer_order(jsonb, jsonb, jsonb, text, text) to authenticated;
