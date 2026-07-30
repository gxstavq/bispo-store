-- Rollback da migration 20260729200000.
-- Segurança: recusa executar se os recursos novos já contiverem dados que seriam perdidos.

begin;

do $$
begin
  if exists (
    select 1 from public.orders
    where payment_status = 'in_analysis'
       or idempotency_key is not null
  ) or exists (
    select 1 from public.payments where status = 'in_analysis'
  ) then
    raise exception 'rollback_blocked_orders_use_new_pagbank_fields';
  end if;

  if exists (select 1 from public.inventory_reservations) then
    raise exception 'rollback_blocked_inventory_reservations_not_empty';
  end if;
end;
$$;

drop trigger if exists orders_release_terminal_reservations on public.orders;
drop function if exists private.release_terminal_order_reservations();
drop function if exists public.release_order_stock_reservation(uuid, text);
drop function if exists public.reserve_order_stock(uuid, timestamptz);
drop function if exists public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
);

drop table if exists public.inventory_reservations;
drop index if exists public.orders_customer_idempotency_uidx;

alter table public.orders
  drop column if exists idempotency_fingerprint,
  drop column if exists idempotency_key;

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
    update public.orders set payment_status = 'paid', status = 'paid'
    where id = order_record.id;
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

revoke all on function public.confirm_pagbank_payment(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_pagbank_payment(text, text, text, text)
  to service_role;

commit;
