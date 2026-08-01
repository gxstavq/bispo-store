-- Revisão final do painel administrativo.
-- Migration incremental: preserva registros existentes e concentra mutações
-- sensíveis em funções transacionais executáveis somente por administradores.

begin;

alter table public.categories
  add column if not exists description text,
  add column if not exists image_url text,
  add column if not exists archived_at timestamptz;

do $$
begin
  alter table public.categories drop constraint if exists categories_slug_check;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_slug_format_check'
  ) then
    alter table public.categories
      add constraint categories_slug_format_check
      check (
        length(slug) between 2 and 80
        and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      ) not valid;
    alter table public.categories validate constraint categories_slug_format_check;
  end if;
end;
$$;

alter table public.store_settings
  add column if not exists home_banner jsonb,
  add column if not exists previous_home_banner jsonb;

alter table public.products
  add column if not exists images_confirmed boolean;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  previous_stock integer not null check (previous_stock >= 0),
  new_stock integer not null check (new_stock >= 0),
  difference integer not null,
  operation text not null check (operation in ('add', 'remove', 'set')),
  quantity integer not null check (quantity >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 200),
  note text,
  admin_user_id uuid not null references auth.users(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_variant_created_idx
  on public.inventory_movements(variant_id, created_at desc);
create index if not exists inventory_movements_product_created_idx
  on public.inventory_movements(product_id, created_at desc);

alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from public, anon, authenticated;
grant select, insert on public.inventory_movements to authenticated, service_role;

drop policy if exists inventory_movements_admin_read on public.inventory_movements;
create policy inventory_movements_admin_read on public.inventory_movements
for select to authenticated using ((select private.is_admin()));

create or replace function public.save_admin_product(
  target_product_id uuid,
  product_data jsonb,
  images_data jsonb,
  variants_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
set statement_timeout = '20s'
as $$
declare
  saved_product_id uuid;
  selected_category_id uuid;
  selected_category_active boolean;
  existing_variant record;
  has_dependency boolean;
  has_active_reservation boolean;
begin
  if auth.role() <> 'service_role' and not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if jsonb_typeof(product_data) <> 'object'
    or jsonb_typeof(images_data) <> 'array'
    or jsonb_typeof(variants_data) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_product_payload';
  end if;

  select categories.id, categories.active into selected_category_id, selected_category_active
  from public.categories as categories
  where categories.slug = btrim(product_data ->> 'category_slug');
  if selected_category_id is null then
    raise exception using errcode = 'P0001', message = 'category_not_found';
  end if;
  if product_data ->> 'status' = 'active' and not selected_category_active then
    raise exception using errcode = 'P0001', message = 'inactive_category';
  end if;

  if coalesce((product_data ->> 'price')::numeric, -1) < 0
    or (
      nullif(product_data ->> 'promotional_price', '') is not null
      and (
        (product_data ->> 'promotional_price')::numeric < 0
        or (product_data ->> 'promotional_price')::numeric >= (product_data ->> 'price')::numeric
      )
    ) then
    raise exception using errcode = '22023', message = 'invalid_price';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(variants_data) as incoming(
      id uuid, sku text, size text, color text, stock integer, active boolean
    )
    where nullif(btrim(incoming.sku), '') is null
      or nullif(btrim(incoming.size), '') is null
      or nullif(btrim(incoming.color), '') is null
      or incoming.stock < 0
  ) then
    raise exception using errcode = '22023', message = 'invalid_variant';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(variants_data) as incoming(
      id uuid, sku text, size text, color text, stock integer, active boolean
    )
    group by lower(btrim(incoming.size)), lower(btrim(incoming.color))
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate_variant';
  end if;

  if target_product_id is null then
    insert into public.products(
      category_id, name, slug, code, description, price, promotional_price,
      weight_kg, length_cm, width_cm, height_cm, packaging_category,
      shipping_enabled, featured, is_new, status, needs_review, images_confirmed, published_at
    ) values (
      selected_category_id,
      btrim(product_data ->> 'name'),
      btrim(product_data ->> 'slug'),
      btrim(product_data ->> 'code'),
      coalesce(product_data ->> 'description', ''),
      (product_data ->> 'price')::numeric,
      nullif(product_data ->> 'promotional_price', '')::numeric,
      nullif(product_data ->> 'weight_kg', '')::numeric,
      nullif(product_data ->> 'length_cm', '')::numeric,
      nullif(product_data ->> 'width_cm', '')::numeric,
      nullif(product_data ->> 'height_cm', '')::numeric,
      coalesce(nullif(product_data ->> 'packaging_category', ''), 'a-definir'),
      coalesce((product_data ->> 'shipping_enabled')::boolean, false),
      coalesce((product_data ->> 'featured')::boolean, false),
      coalesce((product_data ->> 'is_new')::boolean, false),
      coalesce(nullif(product_data ->> 'status', ''), 'draft'),
      coalesce((product_data ->> 'needs_review')::boolean, true),
      coalesce((product_data ->> 'images_confirmed')::boolean, false),
      case when product_data ->> 'status' = 'active' then now() else null end
    ) returning id into saved_product_id;
  else
    perform products.id
    from public.products as products
    where products.id = target_product_id
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'product_not_found';
    end if;
    update public.products as products set
      category_id = selected_category_id,
      name = btrim(product_data ->> 'name'),
      slug = btrim(product_data ->> 'slug'),
      code = btrim(product_data ->> 'code'),
      description = coalesce(product_data ->> 'description', ''),
      price = (product_data ->> 'price')::numeric,
      promotional_price = nullif(product_data ->> 'promotional_price', '')::numeric,
      weight_kg = nullif(product_data ->> 'weight_kg', '')::numeric,
      length_cm = nullif(product_data ->> 'length_cm', '')::numeric,
      width_cm = nullif(product_data ->> 'width_cm', '')::numeric,
      height_cm = nullif(product_data ->> 'height_cm', '')::numeric,
      packaging_category = coalesce(nullif(product_data ->> 'packaging_category', ''), 'a-definir'),
      shipping_enabled = coalesce((product_data ->> 'shipping_enabled')::boolean, false),
      featured = coalesce((product_data ->> 'featured')::boolean, false),
      is_new = coalesce((product_data ->> 'is_new')::boolean, false),
      status = coalesce(nullif(product_data ->> 'status', ''), products.status),
      needs_review = coalesce((product_data ->> 'needs_review')::boolean, true),
      images_confirmed = coalesce((product_data ->> 'images_confirmed')::boolean, products.images_confirmed, false),
      published_at = case
        when product_data ->> 'status' = 'active' then coalesce(products.published_at, now())
        else null
      end
    where products.id = target_product_id;
    saved_product_id := target_product_id;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(images_data) as incoming(
      storage_path text, public_url text, thumbnail_storage_path text,
      thumbnail_public_url text, alt_text text, position integer, is_cover boolean
    )
    where nullif(btrim(incoming.storage_path), '') is null
      or nullif(btrim(incoming.public_url), '') is null
      or incoming.position < 0
  ) then
    raise exception using errcode = '22023', message = 'invalid_image';
  end if;
  if (
    select count(*) from jsonb_to_recordset(images_data) as incoming(
      storage_path text, public_url text, thumbnail_storage_path text,
      thumbnail_public_url text, alt_text text, position integer, is_cover boolean
    ) where coalesce(incoming.is_cover, false)
  ) > 1 then
    raise exception using errcode = '22023', message = 'multiple_cover_images';
  end if;

  update public.product_images as images
  set is_cover = false
  where images.product_id = saved_product_id;

  insert into public.product_images as images(
    product_id, storage_path, public_url, thumbnail_storage_path,
    thumbnail_public_url, alt_text, position, is_cover
  )
  select saved_product_id, btrim(incoming.storage_path), btrim(incoming.public_url),
    nullif(btrim(incoming.thumbnail_storage_path), ''),
    nullif(btrim(incoming.thumbnail_public_url), ''),
    nullif(btrim(incoming.alt_text), ''), incoming.position,
    coalesce(incoming.is_cover, false)
  from jsonb_to_recordset(images_data) as incoming(
    storage_path text, public_url text, thumbnail_storage_path text,
    thumbnail_public_url text, alt_text text, position integer, is_cover boolean
  )
  order by incoming.position
  on conflict (product_id, storage_path) do update set
    public_url = excluded.public_url,
    thumbnail_storage_path = excluded.thumbnail_storage_path,
    thumbnail_public_url = excluded.thumbnail_public_url,
    alt_text = excluded.alt_text,
    position = excluded.position,
    is_cover = excluded.is_cover;

  delete from public.product_images as images
  where images.product_id = saved_product_id
    and not exists (
      select 1
      from jsonb_to_recordset(images_data) as incoming(
        storage_path text, public_url text, thumbnail_storage_path text,
        thumbnail_public_url text, alt_text text, position integer, is_cover boolean
      )
      where btrim(incoming.storage_path) = images.storage_path
    );

  perform variants.id
  from public.product_variants as variants
  where variants.product_id = saved_product_id
  order by variants.id
  for update;

  if exists (
    select 1
    from jsonb_to_recordset(variants_data) as incoming(
      id uuid, sku text, size text, color text, stock integer, active boolean
    )
    join public.product_variants as variants on variants.id = incoming.id
    where variants.product_id <> saved_product_id
  ) then
    raise exception using errcode = '22023', message = 'variant_product_mismatch';
  end if;

  update public.product_variants as variants
  set sku = btrim(incoming.sku),
      size = btrim(incoming.size),
      color = btrim(incoming.color),
      stock = incoming.stock,
      active = coalesce(incoming.active, true),
      updated_at = now()
  from jsonb_to_recordset(variants_data) as incoming(
    id uuid, sku text, size text, color text, stock integer, active boolean
  )
  where incoming.id is not null
    and variants.id = incoming.id
    and variants.product_id = saved_product_id;

  insert into public.product_variants as variants(
    product_id, sku, size, color, stock, active
  )
  select saved_product_id, btrim(incoming.sku), btrim(incoming.size),
    btrim(incoming.color), incoming.stock, coalesce(incoming.active, true)
  from jsonb_to_recordset(variants_data) as incoming(
    id uuid, sku text, size text, color text, stock integer, active boolean
  )
  where incoming.id is null
  order by lower(btrim(incoming.size)), lower(btrim(incoming.color))
  on conflict (product_id, size, color) do update set
    sku = excluded.sku,
    stock = excluded.stock,
    active = excluded.active,
    updated_at = now();

  for existing_variant in
    select variants.id
    from public.product_variants as variants
    where variants.product_id = saved_product_id
      and not exists (
        select 1
        from jsonb_to_recordset(variants_data) as incoming(
          id uuid, sku text, size text, color text, stock integer, active boolean
        )
        where incoming.id = variants.id
          or (
            incoming.id is null
            and lower(btrim(incoming.size)) = lower(variants.size)
            and lower(btrim(incoming.color)) = lower(variants.color)
          )
      )
    order by variants.id
  loop
    select exists (
      select 1 from public.order_items as items where items.variant_id = existing_variant.id
    ) or exists (
      select 1 from public.inventory_reservations as reservations
      where reservations.variant_id = existing_variant.id
    ) into has_dependency;
    select exists (
      select 1 from public.inventory_reservations as reservations
      where reservations.variant_id = existing_variant.id
        and reservations.status = 'active'
        and reservations.expires_at > now()
    ) into has_active_reservation;

    if has_dependency then
      update public.product_variants as variants
      set active = false,
          stock = case when has_active_reservation then variants.stock else 0 end,
          updated_at = now()
      where variants.id = existing_variant.id;
    else
      delete from public.product_variants as variants
      where variants.id = existing_variant.id;
    end if;
  end loop;

  return saved_product_id;
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise exception using errcode = '55P03', message = 'product_update_conflict';
end;
$$;

revoke all on function public.save_admin_product(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_admin_product(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

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

create or replace function public.adjust_product_variant_stock(
  target_variant_id uuid,
  adjustment_operation text,
  adjustment_quantity integer,
  adjustment_reason text,
  adjustment_note text,
  request_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $$
declare
  selected_variant public.product_variants;
  existing_movement public.inventory_movements;
  calculated_stock integer;
  movement_id uuid;
begin
  if auth.role() <> 'service_role' and not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if adjustment_operation not in ('add', 'remove', 'set')
    or adjustment_quantity is null or adjustment_quantity < 0
    or length(btrim(coalesce(adjustment_reason, ''))) < 3
    or length(request_idempotency_key) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'invalid_stock_adjustment';
  end if;

  select movements.* into existing_movement
  from public.inventory_movements as movements
  where movements.idempotency_key = request_idempotency_key;
  if existing_movement.id is not null then
    return jsonb_build_object(
      'movement_id', existing_movement.id,
      'previous_stock', existing_movement.previous_stock,
      'new_stock', existing_movement.new_stock,
      'difference', existing_movement.difference,
      'duplicate', true
    );
  end if;

  select variants.* into selected_variant
  from public.product_variants as variants
  where variants.id = target_variant_id
  for update;
  if selected_variant.id is null then
    raise exception using errcode = 'P0001', message = 'variant_not_found';
  end if;

  calculated_stock := case adjustment_operation
    when 'add' then selected_variant.stock + adjustment_quantity
    when 'remove' then selected_variant.stock - adjustment_quantity
    else adjustment_quantity
  end;
  if calculated_stock < 0 then
    raise exception using errcode = 'P0001', message = 'negative_stock_not_allowed';
  end if;

  update public.product_variants as variants
  set stock = calculated_stock
  where variants.id = selected_variant.id;
  insert into public.inventory_movements(
    product_id, variant_id, previous_stock, new_stock, difference,
    operation, quantity, reason, note, admin_user_id, idempotency_key
  ) values (
    selected_variant.product_id, selected_variant.id, selected_variant.stock,
    calculated_stock, calculated_stock - selected_variant.stock,
    adjustment_operation, adjustment_quantity, btrim(adjustment_reason),
    nullif(btrim(coalesce(adjustment_note, '')), ''), auth.uid(),
    request_idempotency_key
  ) returning id into movement_id;

  return jsonb_build_object(
    'movement_id', movement_id,
    'previous_stock', selected_variant.stock,
    'new_stock', calculated_stock,
    'difference', calculated_stock - selected_variant.stock,
    'duplicate', false
  );
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise exception using errcode = '55P03', message = 'stock_adjustment_conflict';
end;
$$;

revoke all on function public.adjust_product_variant_stock(uuid, text, integer, text, text, text)
  from public, anon;
grant execute on function public.adjust_product_variant_stock(uuid, text, integer, text, text, text)
  to authenticated, service_role;

create or replace function public.delete_or_archive_category(
  target_category_id uuid,
  replacement_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_category public.categories;
  product_count integer;
begin
  if auth.role() <> 'service_role' and not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select categories.* into selected_category
  from public.categories as categories
  where categories.id = target_category_id
  for update;
  if selected_category.id is null then
    raise exception using errcode = 'P0001', message = 'category_not_found';
  end if;
  select count(*) into product_count
  from public.products as products
  where products.category_id = target_category_id;

  if product_count = 0 then
    delete from public.categories where id = target_category_id;
    return jsonb_build_object('deleted', true, 'archived', false, 'reassigned', 0);
  end if;
  if replacement_category_id is not null then
    if replacement_category_id = target_category_id or not exists (
      select 1 from public.categories as categories
      where categories.id = replacement_category_id and categories.active
    ) then
      raise exception using errcode = '22023', message = 'invalid_replacement_category';
    end if;
    perform products.id from public.products as products
    where products.category_id = target_category_id order by products.id for update;
    update public.products set category_id = replacement_category_id
    where category_id = target_category_id;
    delete from public.categories where id = target_category_id;
    return jsonb_build_object('deleted', true, 'archived', false, 'reassigned', product_count);
  end if;

  update public.categories
  set active = false, archived_at = now()
  where id = target_category_id;
  return jsonb_build_object('deleted', false, 'archived', true, 'reassigned', 0);
end;
$$;

revoke all on function public.delete_or_archive_category(uuid, uuid)
  from public, anon;
grant execute on function public.delete_or_archive_category(uuid, uuid)
  to authenticated, service_role;

create or replace function public.cancel_manual_order(
  target_order_number text,
  cancellation_note text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_order public.orders;
  released_count integer;
  selected_order_id uuid;
begin
  if not private.is_admin(target_actor_user_id) or (
    auth.role() <> 'service_role' and auth.uid() is distinct from target_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select orders.id into selected_order_id
  from public.orders as orders
  where orders.order_number = target_order_number;
  if selected_order_id is null then
    raise exception using errcode = 'P0001', message = 'order_not_found';
  end if;
  perform payments.id from public.payments as payments
  where payments.order_id = selected_order_id order by payments.id for update;
  select orders.* into selected_order
  from public.orders as orders
  where orders.id = selected_order_id
  for update;
  if selected_order.id is null then
    raise exception using errcode = 'P0001', message = 'order_not_found';
  end if;
  if selected_order.payment_status = 'paid' or selected_order.stock_deducted_at is not null then
    raise exception using errcode = 'P0001', message = 'paid_order_cannot_be_cancelled';
  end if;
  if selected_order.status = 'cancelled' then
    return jsonb_build_object('duplicate', true, 'released', 0);
  end if;

  update public.inventory_reservations as reservations
  set status = 'released', release_reason = 'admin_cancelled_whatsapp_order', updated_at = now()
  where reservations.order_id = selected_order.id and reservations.status = 'active';
  get diagnostics released_count = row_count;
  update public.payments as payments
  set status = 'cancelled', raw_status = 'CANCELLED_BY_ADMIN'
  where payments.order_id = selected_order.id and payments.status <> 'paid';
  update public.orders as orders
  set status = 'cancelled', payment_status = 'cancelled', shipping_status = 'cancelled'
  where orders.id = selected_order.id;
  update public.order_status_history as history
  set note = cancellation_note, changed_by = target_actor_user_id
  where history.id = (
    select latest.id from public.order_status_history as latest
    where latest.order_id = selected_order.id and latest.to_status = 'cancelled'
    order by latest.created_at desc limit 1
  );
  return jsonb_build_object('duplicate', false, 'released', released_count);
end;
$$;

revoke all on function public.cancel_manual_order(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_manual_order(text, text, uuid)
  to service_role;

create or replace function public.confirm_manual_order_payment(
  target_order_number text,
  target_actor_user_id uuid,
  confirmation_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $$
declare
  selected_order public.orders;
  selected_payment_id uuid;
  checkout_identifier text;
  total_amount numeric(12,2);
  confirmation_result record;
  selected_order_id uuid;
begin
  if not private.is_admin(target_actor_user_id) or (
    auth.role() <> 'service_role' and auth.uid() is distinct from target_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select orders.id into selected_order_id
  from public.orders as orders
  where orders.order_number = target_order_number;
  if selected_order_id is null then
    raise exception using errcode = 'P0001', message = 'order_not_found';
  end if;

  select orders.* into selected_order
  from public.orders as orders
  where orders.id = selected_order_id;
  if selected_order.payment_status = 'paid' or selected_order.status = 'paid' then
    return jsonb_build_object(
      'duplicate', true,
      'stock_deducted', selected_order.stock_deducted_at is not null,
      'stock_error', selected_order.stock_deduction_error
    );
  end if;
  if selected_order.status <> 'awaiting_payment' or selected_order.shipping_amount is null then
    raise exception using errcode = 'P0001', message = 'order_not_awaiting_payment';
  end if;

  checkout_identifier := 'WHATSAPP:' || target_order_number;
  total_amount := selected_order.subtotal + selected_order.shipping_amount;
  insert into public.payments(
    order_id, provider, external_reference, checkout_id, amount, status,
    payment_method, raw_status, provider_payload
  ) values (
    selected_order_id, 'pagbank_manual', target_order_number,
    checkout_identifier, total_amount, 'pending',
    'PagBank conferido manualmente', 'AWAITING_MANUAL_CONFIRMATION',
    jsonb_build_object('source', 'whatsapp_manual_confirmation', 'confirmed_by', target_actor_user_id)
  ) on conflict (checkout_id) do nothing;

  select payments.id into selected_payment_id
  from public.payments as payments
  where payments.checkout_id = checkout_identifier
  for update;
  if selected_payment_id is null then
    raise exception using errcode = 'P0001', message = 'manual_payment_not_found';
  end if;

  select orders.* into selected_order
  from public.orders as orders
  where orders.id = selected_order_id
  for update;
  if selected_order.payment_status = 'paid' or selected_order.status = 'paid' then
    return jsonb_build_object(
      'duplicate', true,
      'stock_deducted', selected_order.stock_deducted_at is not null,
      'stock_error', selected_order.stock_deduction_error
    );
  end if;
  if selected_order.status <> 'awaiting_payment' or selected_order.shipping_amount is null then
    raise exception using errcode = 'P0001', message = 'order_not_awaiting_payment';
  end if;

  select * into confirmation_result
  from public.confirm_pagbank_payment(
    checkout_identifier,
    'paid',
    'PagBank conferido manualmente',
    'MANUALLY_CONFIRMED_BY_ADMIN'
  );
  if confirmation_result.stock_error is not null then
    raise exception using errcode = 'P0001', message = 'insufficient_stock';
  end if;

  insert into public.payment_events(
    payment_id, provider, event_type, provider_event_id,
    provider_status, verified, payload
  ) values (
    selected_payment_id, 'pagbank_manual', 'manual_payment_confirmed_by_admin',
    'manual-payment-confirmed-' || selected_order.id::text,
    'PAID', true,
    jsonb_build_object('source', 'admin_pagbank_app_check', 'confirmed_by', target_actor_user_id)
  ) on conflict (provider, provider_event_id) where provider_event_id is not null do nothing;

  update public.order_status_history as history
  set note = confirmation_note, changed_by = target_actor_user_id
  where history.id = (
    select latest.id from public.order_status_history as latest
    where latest.order_id = selected_order.id and latest.to_status = 'paid'
    order by latest.created_at desc limit 1
  );

  return jsonb_build_object(
    'duplicate', false,
    'stock_deducted', coalesce(confirmation_result.stock_deducted, false),
    'stock_error', confirmation_result.stock_error
  );
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise exception using errcode = '55P03', message = 'payment_confirmation_conflict';
end;
$$;

revoke all on function public.confirm_manual_order_payment(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_manual_order_payment(text, uuid, text)
  to service_role;

commit;
