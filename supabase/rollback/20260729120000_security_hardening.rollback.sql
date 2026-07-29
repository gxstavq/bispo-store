-- Rollback manual da migration 20260729120000_security_hardening.
--
-- Ordem segura:
-- 1. Remova/desative qualquer Deploy Preview que use consume_api_rate_limit.
-- 2. Confirme que a URL principal ainda executa a versão anterior.
-- 3. Execute este arquivo em uma única transação no Supabase de homologação.
-- 4. Repita os testes de login, catálogo, pedidos e RLS.
--
-- Este rollback não apaga produtos, imagens, variantes, usuários, pedidos,
-- clientes, endereços, pagamentos ou configurações. A única tabela removida
-- contém contadores efêmeros criados pela própria migration de segurança.

begin;

alter function public.create_customer_order(jsonb, jsonb, jsonb, text, text, uuid)
  reset statement_timeout;

alter table public.products
  drop constraint if exists products_active_positive_price;
alter table public.products
  drop constraint if exists products_promotional_price_valid;
alter table public.order_items
  drop constraint if exists order_items_quantity_limit;
alter table public.order_items
  drop constraint if exists order_items_positive_unit_price;

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

-- Restaura exatamente o grant abrangente que existia antes da migration.
-- As policies RLS continuam sendo a barreira de autorização.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.categories, public.products, public.product_images, public.product_variants
to anon, authenticated;

revoke all on public.integration_credentials, public.oauth_states from anon, authenticated;

drop function if exists public.consume_api_rate_limit(text, text, integer, integer);
drop table if exists private.api_rate_limits;

commit;
