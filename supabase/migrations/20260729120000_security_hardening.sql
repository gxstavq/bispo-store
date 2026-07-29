-- Endurecimento pré-PagBank: menor privilégio, rate limiting e invariantes comerciais.

create table if not exists private.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_started_at)
);

revoke all on private.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  requested_scope text,
  requested_key_hash text,
  requested_limit integer,
  requested_window_seconds integer
)
returns table(allowed boolean, attempts integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_window timestamptz;
  current_attempts integer;
begin
  if requested_scope !~ '^[a-z0-9-]{1,64}$'
    or requested_key_hash !~ '^[a-f0-9]{64}$'
    or requested_limit < 1 or requested_limit > 1000
    or requested_window_seconds < 1 or requested_window_seconds > 86400
  then
    raise exception 'invalid_rate_limit_request';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / requested_window_seconds)
      * requested_window_seconds
  );

  insert into private.api_rate_limits(scope, key_hash, window_started_at, attempts)
  values (requested_scope, requested_key_hash, current_window, 1)
  on conflict (scope, key_hash, window_started_at)
  do update set attempts = private.api_rate_limits.attempts + 1, updated_at = now()
  returning private.api_rate_limits.attempts into current_attempts;

  delete from private.api_rate_limits
  where window_started_at < now() - interval '2 days';

  return query select
    current_attempts <= requested_limit,
    current_attempts,
    current_window + make_interval(secs => requested_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
to service_role;

-- Não permita que um usuário use o parâmetro da função para consultar outro UUID.
create or replace function private.is_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select check_user = auth.uid() and exists (
    select 1
    from public.admin_users
    where user_id = auth.uid() and active = true
  );
$$;

-- Remove o grant abrangente de migrations antigas e recompõe privilégios explícitos.
revoke all on table
  public.admin_users,
  public.categories,
  public.products,
  public.product_images,
  public.product_variants,
  public.customers,
  public.addresses,
  public.orders,
  public.order_items,
  public.shipping_quotes,
  public.shipping_decisions,
  public.payments,
  public.payment_events,
  public.shipment_labels,
  public.order_status_history,
  public.store_settings,
  public.audit_logs,
  public.integration_errors
from anon, authenticated;

grant select on
  public.categories, public.products, public.product_images, public.product_variants
to anon, authenticated;

grant select on
  public.admin_users, public.customers, public.addresses, public.orders,
  public.order_items, public.shipping_quotes, public.shipping_decisions,
  public.payments, public.payment_events, public.shipment_labels,
  public.order_status_history, public.store_settings, public.audit_logs,
  public.integration_errors
to authenticated;

grant insert, update, delete on
  public.categories, public.products, public.product_images, public.product_variants,
  public.orders, public.order_items, public.shipping_quotes, public.shipping_decisions,
  public.payments, public.payment_events, public.shipment_labels,
  public.order_status_history, public.store_settings
to authenticated;

revoke all on public.integration_credentials, public.oauth_states from anon, authenticated;

alter table public.products
  drop constraint if exists products_active_positive_price;
alter table public.products
  add constraint products_active_positive_price
  check (status <> 'active' or price > 0);

alter table public.products
  drop constraint if exists products_promotional_price_valid;
alter table public.products
  add constraint products_promotional_price_valid
  check (
    promotional_price is null
    or (promotional_price > 0 and promotional_price <= price)
  );

alter table public.order_items
  drop constraint if exists order_items_quantity_limit;
alter table public.order_items
  add constraint order_items_quantity_limit check (quantity between 1 and 20);

alter table public.order_items
  drop constraint if exists order_items_positive_unit_price;
alter table public.order_items
  add constraint order_items_positive_unit_price check (unit_price > 0);

alter function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid)
  set statement_timeout = '5s';
