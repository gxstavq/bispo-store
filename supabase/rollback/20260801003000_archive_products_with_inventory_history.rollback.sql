-- Restore the preceding delete/archive RPC behavior without touching data.

begin;

create or replace function public.delete_or_archive_admin_product(
  target_product_id uuid,
  delete_permanently boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_product public.products;
  has_history boolean;
  paths jsonb;
begin
  if auth.role() <> 'service_role' and not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select products.* into selected_product
  from public.products as products
  where products.id = target_product_id
  for update;
  if selected_product.id is null then
    raise exception using errcode = 'P0001', message = 'product_not_found';
  end if;

  select exists (
    select 1 from public.order_items as items where items.product_id = target_product_id
  ) or exists (
    select 1
    from public.inventory_reservations as reservations
    join public.product_variants as variants on variants.id = reservations.variant_id
    where variants.product_id = target_product_id
  ) into has_history;

  if not delete_permanently or has_history then
    update public.products as products
    set status = 'archived', shipping_enabled = false, published_at = null
    where products.id = target_product_id;
    update public.product_variants as variants
    set active = false, updated_at = now()
    where variants.product_id = target_product_id;
    return jsonb_build_object(
      'deleted', false,
      'archived', true,
      'had_dependencies', has_history,
      'storage_paths', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(distinct images.storage_path), '[]'::jsonb)
    into paths
  from public.product_images as images
  where images.product_id = target_product_id;
  delete from public.products as products where products.id = target_product_id;
  return jsonb_build_object(
    'deleted', true,
    'archived', false,
    'had_dependencies', false,
    'storage_paths', paths
  );
end;
$$;

revoke all on function public.delete_or_archive_admin_product(uuid, boolean)
  from public, anon;
grant execute on function public.delete_or_archive_admin_product(uuid, boolean)
  to authenticated, service_role;

commit;
