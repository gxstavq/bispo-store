create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('tenis', 'calcas', 'conjuntos', 'camisetas', 'moletons', 'calcas-shorts')),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  category_id uuid not null references public.categories(id),
  name text not null,
  slug text not null unique,
  code text not null unique,
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  promotional_price numeric(12,2) check (promotional_price is null or promotional_price >= 0),
  weight_kg numeric(8,3) check (weight_kg is null or weight_kg > 0),
  length_cm numeric(8,2) check (length_cm is null or length_cm > 0),
  width_cm numeric(8,2) check (width_cm is null or width_cm > 0),
  height_cm numeric(8,2) check (height_cm is null or height_cm > 0),
  packaging_category text not null default 'a-definir'
    check (packaging_category in ('caixa-tenis', 'pacote-roupa', 'caixa-conjunto', 'a-definir')),
  shipping_enabled boolean not null default true,
  featured boolean not null default false,
  is_new boolean not null default false,
  status text not null default 'draft' check (status in ('active', 'inactive', 'draft', 'archived')),
  needs_review boolean not null default true,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  thumbnail_storage_path text,
  thumbnail_public_url text,
  alt_text text,
  position integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, storage_path)
);

create unique index product_images_single_cover_idx
  on public.product_images(product_id) where is_cover;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  size text not null,
  color text not null,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  whatsapp text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  postal_code text not null,
  street text not null,
  number text not null,
  complement text,
  district text not null,
  city text not null,
  state text not null default 'SP' check (state = 'SP'),
  reference text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id),
  address_id uuid not null references public.addresses(id),
  status text not null check (status in (
    'awaiting_local_delivery_review', 'local_delivery_approved', 'local_delivery_rejected',
    'awaiting_shipping_selection', 'awaiting_payment', 'paid', 'preparing',
    'shipped', 'delivered', 'cancelled'
  )),
  delivery_choice text not null check (delivery_choice in ('local_delivery_review', 'shipping_quote')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_amount numeric(12,2) check (shipping_amount is null or shipping_amount >= 0),
  total numeric(12,2) generated always as (subtotal + coalesce(shipping_amount, 0)) stored,
  payment_status text not null default 'not_generated'
    check (payment_status in ('not_generated', 'awaiting_payment', 'paid', 'cancelled')),
  shipping_status text not null
    check (shipping_status in ('awaiting_review', 'awaiting_selection', 'free_approved', 'selected', 'shipped', 'delivered', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_snapshot jsonb not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create table public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'manual',
  service_name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  estimated_days integer check (estimated_days is null or estimated_days >= 0),
  selected boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.shipping_decisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  decision text not null check (decision in ('local_approved', 'local_rejected', 'conventional_selected')),
  note text not null,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'manual',
  external_reference text,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null check (status in ('not_generated', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table public.shipment_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  storage_path text,
  tracking_code text,
  status text not null default 'pending' check (status in ('pending', 'generated', 'cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.store_settings (
  singleton boolean primary key default true check (singleton),
  store_name text not null,
  owner_name text not null,
  origin_address text not null,
  origin_postal_code text not null,
  whatsapp text not null,
  commercial_email text not null,
  cnpj_last4 text check (cnpj_last4 is null or length(cnpj_last4) = 4),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'PUBLISH', 'ARCHIVE')),
  changed_fields text[] not null default '{}',
  old_data jsonb,
  new_data jsonb,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index products_category_id_idx on public.products(category_id);
create index products_status_idx on public.products(status) where deleted_at is null;
create index product_images_product_id_idx on public.product_images(product_id);
create index product_variants_product_id_idx on public.product_variants(product_id);
create index customers_user_id_idx on public.customers(user_id);
create index addresses_customer_id_idx on public.addresses(customer_id);
create index orders_customer_id_idx on public.orders(customer_id);
create index orders_status_idx on public.orders(status);
create index order_items_order_id_idx on public.order_items(order_id);
create index shipping_quotes_order_id_idx on public.shipping_quotes(order_id);
create index shipping_decisions_order_id_idx on public.shipping_decisions(order_id);
create index payments_order_id_idx on public.payments(order_id);
create index payment_events_payment_id_idx on public.payment_events(payment_id);
create index shipment_labels_order_id_idx on public.shipment_labels(order_id);
create index order_status_history_order_id_idx on public.order_status_history(order_id);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id, created_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger admin_users_updated_at before update on public.admin_users
for each row execute function private.touch_updated_at();
create trigger categories_updated_at before update on public.categories
for each row execute function private.touch_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function private.touch_updated_at();
create trigger product_variants_updated_at before update on public.product_variants
for each row execute function private.touch_updated_at();
create trigger customers_updated_at before update on public.customers
for each row execute function private.touch_updated_at();
create trigger addresses_updated_at before update on public.addresses
for each row execute function private.touch_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function private.touch_updated_at();
create trigger payments_updated_at before update on public.payments
for each row execute function private.touch_updated_at();
create trigger store_settings_updated_at before update on public.store_settings
for each row execute function private.touch_updated_at();

create or replace function private.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_json jsonb;
  new_json jsonb;
  changed text[];
  target_id uuid;
  audit_action text := tg_op;
begin
  old_json := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  target_id := coalesce((new_json ->> 'id')::uuid, (old_json ->> 'id')::uuid);

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into changed
      from jsonb_object_keys(old_json || new_json) key
      where old_json -> key is distinct from new_json -> key;
  else
    changed := array[]::text[];
  end if;

  if tg_table_name = 'products' and tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'active' then
      audit_action := 'PUBLISH';
    elsif new.status = 'archived' then
      audit_action := 'ARCHIVE';
    end if;
  end if;

  insert into public.audit_logs(
    table_name, record_id, action, changed_fields, old_data, new_data, actor_user_id
  ) values (
    tg_table_name, target_id, audit_action, changed, old_json, new_json, auth.uid()
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger products_audit after insert or update or delete on public.products
for each row execute function private.capture_audit_log();
create trigger product_variants_audit after insert or update or delete on public.product_variants
for each row execute function private.capture_audit_log();
create trigger orders_audit after insert or update or delete on public.orders
for each row execute function private.capture_audit_log();
create trigger shipping_quotes_audit after insert or update or delete on public.shipping_quotes
for each row execute function private.capture_audit_log();
create trigger shipping_decisions_audit after insert or update or delete on public.shipping_decisions
for each row execute function private.capture_audit_log();
create trigger payments_audit after insert or update or delete on public.payments
for each row execute function private.capture_audit_log();

create or replace function private.capture_order_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_status_history after insert or update of status on public.orders
for each row execute function private.capture_order_status();
