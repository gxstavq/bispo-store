-- Corrige ambiguidades PL/pgSQL em confirm_pagbank_payment sem alterar regras.
-- A função anterior é preservada em private para rollback estrutural.

begin;

alter function public.confirm_pagbank_payment(text, text, text, text)
  set schema private;
alter function private.confirm_pagbank_payment(text, text, text, text)
  rename to confirm_pagbank_payment_pre_20260729204000;

revoke all on function private.confirm_pagbank_payment_pre_20260729204000(
  text, text, text, text
) from public, anon, authenticated, service_role;

create function public.confirm_pagbank_payment(
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
  selected_payment public.payments;
  selected_order public.orders;
  has_insufficient_stock boolean := false;
begin
  if confirmed_status not in (
    'pending', 'in_analysis', 'paid', 'declined', 'expired', 'cancelled'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_payment_status';
  end if;

  select payments.*
    into selected_payment
  from public.payments as payments
  where payments.checkout_id = target_checkout_id
  for update;

  if selected_payment.id is null then
    raise exception using errcode = 'P0001', message = 'payment_not_found';
  end if;

  select orders.*
    into selected_order
  from public.orders as orders
  where orders.id = selected_payment.order_id
  for update;

  if selected_order.id is null then
    raise exception using errcode = 'P0001', message = 'order_not_found';
  end if;

  update public.payments as payments
  set status = confirmed_status,
      payment_method = coalesce(confirmed_method, payments.payment_method),
      raw_status = provider_raw_status,
      confirmed_at = case
        when confirmed_status = 'paid' then now()
        else payments.confirmed_at
      end,
      updated_at = now()
  where payments.id = selected_payment.id;

  if confirmed_status = 'paid' then
    update public.orders as orders
    set payment_status = 'paid',
        status = 'paid'
    where orders.id = selected_order.id;

    if selected_order.stock_deducted_at is null then
      -- Todas as variantes são bloqueadas em ordem determinística.
      perform variants.id
      from public.product_variants as variants
      join (
        select order_items.variant_id
        from public.order_items as order_items
        where order_items.order_id = selected_order.id
        group by order_items.variant_id
      ) as locked_items on locked_items.variant_id = variants.id
      order by variants.id
      for update of variants;

      select exists (
        select 1
        from (
          select
            order_items.variant_id,
            sum(order_items.quantity)::integer as quantity
          from public.order_items as order_items
          where order_items.order_id = selected_order.id
          group by order_items.variant_id
        ) as aggregated_items
        left join public.product_variants as variants
          on variants.id = aggregated_items.variant_id
        where variants.id is null
          or variants.stock - coalesce((
            select sum(reservations.quantity)
            from public.inventory_reservations as reservations
            where reservations.variant_id = aggregated_items.variant_id
              and reservations.order_id <> selected_order.id
              and reservations.status = 'active'
              and reservations.expires_at > now()
          ), 0) < aggregated_items.quantity
      ) into has_insufficient_stock;

      if has_insufficient_stock then
        update public.orders as orders
        set stock_deduction_error =
          'Estoque insuficiente no momento da confirmação PagBank.'
        where orders.id = selected_order.id;

        update public.payments as payments
        set last_error =
          'Pagamento confirmado, mas o estoque não pôde ser reduzido.'
        where payments.id = selected_payment.id;

        update public.inventory_reservations as reservations
        set status = 'released',
            release_reason = 'insufficient_stock_after_payment',
            updated_at = now()
        where reservations.order_id = selected_order.id
          and reservations.status = 'active';
      else
        update public.product_variants as variants
        set stock = variants.stock - aggregated_items.quantity
        from (
          select
            order_items.variant_id,
            sum(order_items.quantity)::integer as quantity
          from public.order_items as order_items
          where order_items.order_id = selected_order.id
          group by order_items.variant_id
        ) as aggregated_items
        where variants.id = aggregated_items.variant_id;

        update public.orders as orders
        set stock_deducted_at = now(),
            stock_deduction_error = null
        where orders.id = selected_order.id;

        update public.inventory_reservations as reservations
        set status = 'consumed',
            release_reason = 'payment_confirmed',
            updated_at = now()
        where reservations.order_id = selected_order.id
          and reservations.status = 'active';
      end if;
    end if;
  elsif confirmed_status = 'in_analysis' then
    update public.orders as orders
    set payment_status = 'in_analysis'
    where orders.id = selected_order.id;

    update public.inventory_reservations as reservations
    set expires_at = greatest(
          reservations.expires_at,
          now() + interval '2 hours'
        ),
        updated_at = now()
    where reservations.order_id = selected_order.id
      and reservations.status = 'active';
  elsif confirmed_status = 'declined' then
    update public.orders as orders
    set payment_status = 'declined'
    where orders.id = selected_order.id;
  elsif confirmed_status = 'expired' then
    update public.orders as orders
    set payment_status = 'expired'
    where orders.id = selected_order.id;
  elsif confirmed_status = 'cancelled' then
    update public.orders as orders
    set payment_status = 'cancelled'
    where orders.id = selected_order.id;
  else
    update public.orders as orders
    set payment_status = 'awaiting_payment'
    where orders.id = selected_order.id;
  end if;

  return query
  select
    selected_payment.id,
    selected_order.id,
    (
      select orders.stock_deducted_at is not null
      from public.orders as orders
      where orders.id = selected_order.id
    ),
    (
      select orders.stock_deduction_error
      from public.orders as orders
      where orders.id = selected_order.id
    );
end;
$$;

revoke all on function public.confirm_pagbank_payment(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_pagbank_payment(text, text, text, text)
  to service_role;

commit;
