create or replace function private.is_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = check_user and active = true
  );
$$;

revoke all on function private.is_admin(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;

alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.customers enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shipping_quotes enable row level security;
alter table public.shipping_decisions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.shipment_labels enable row level security;
alter table public.order_status_history enable row level security;
alter table public.store_settings enable row level security;
alter table public.audit_logs enable row level security;

grant select on public.categories, public.products, public.product_images, public.product_variants to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy categories_public_read on public.categories
for select to anon, authenticated using (active = true);
create policy products_public_read on public.products
for select to anon, authenticated using (status = 'active' and deleted_at is null);
create policy product_images_public_read on public.product_images
for select to anon, authenticated using (
  product_id in (select id from public.products where status = 'active' and deleted_at is null)
);
create policy product_variants_public_read on public.product_variants
for select to anon, authenticated using (
  active = true and product_id in (
    select id from public.products where status = 'active' and deleted_at is null
  )
);

create policy admin_users_admin_all on public.admin_users
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
create policy categories_admin_all on public.categories
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
create policy products_admin_all on public.products
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
create policy product_images_admin_all on public.product_images
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
create policy product_variants_admin_all on public.product_variants
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy customers_own_read on public.customers
for select to authenticated using ((select auth.uid()) = user_id);
create policy customers_own_insert on public.customers
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customers_own_update on public.customers
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy customers_admin_all on public.customers
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy addresses_own_read on public.addresses
for select to authenticated using (
  customer_id in (select id from public.customers where user_id = (select auth.uid()))
);
create policy addresses_own_insert on public.addresses
for insert to authenticated with check (
  customer_id in (select id from public.customers where user_id = (select auth.uid()))
);
create policy addresses_own_update on public.addresses
for update to authenticated
using (customer_id in (select id from public.customers where user_id = (select auth.uid())))
with check (customer_id in (select id from public.customers where user_id = (select auth.uid())));
create policy addresses_admin_all on public.addresses
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy orders_own_read on public.orders
for select to authenticated using (
  customer_id in (select id from public.customers where user_id = (select auth.uid()))
);
create policy orders_own_insert on public.orders
for insert to authenticated with check (
  customer_id in (select id from public.customers where user_id = (select auth.uid()))
);
create policy orders_admin_all on public.orders
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy order_items_own_read on public.order_items
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy order_items_own_insert on public.order_items
for insert to authenticated with check (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy order_items_admin_all on public.order_items
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy shipping_quotes_own_read on public.shipping_quotes
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy shipping_quotes_admin_all on public.shipping_quotes
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy shipping_decisions_own_read on public.shipping_decisions
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy shipping_decisions_admin_all on public.shipping_decisions
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy payments_own_read on public.payments
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy payments_admin_all on public.payments
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy payment_events_own_read on public.payment_events
for select to authenticated using (
  payment_id in (
    select p.id from public.payments p
    join public.orders o on o.id = p.order_id
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy payment_events_admin_all on public.payment_events
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy shipment_labels_own_read on public.shipment_labels
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy shipment_labels_admin_all on public.shipment_labels
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy order_history_own_read on public.order_status_history
for select to authenticated using (
  order_id in (
    select o.id from public.orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = (select auth.uid())
  )
);
create policy order_history_admin_all on public.order_status_history
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy store_settings_admin_all on public.store_settings
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
create policy audit_logs_admin_read on public.audit_logs
for select to authenticated using ((select private.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_storage_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');
create policy product_images_storage_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_storage_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and (select private.is_admin()))
with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_storage_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and (select private.is_admin()));
