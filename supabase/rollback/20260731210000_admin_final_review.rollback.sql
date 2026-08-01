-- Rollback seguro da revisão final do painel.
-- Recusa remover a estrutura se houver categorias dinâmicas ou movimentos,
-- evitando perda silenciosa de dados criados após a migration.

begin;

do $$
begin
  if exists (
    select 1 from public.categories
    where slug not in ('tenis', 'calcas', 'conjuntos', 'camisetas', 'moletons', 'calcas-shorts')
  ) then
    raise exception 'rollback_blocked_dynamic_categories_exist';
  end if;
  if exists (select 1 from public.inventory_movements) then
    raise exception 'rollback_blocked_inventory_movements_exist';
  end if;
  if exists (select 1 from public.products where images_confirmed is not null) then
    raise exception 'rollback_blocked_image_confirmations_exist';
  end if;
end;
$$;

drop function if exists public.confirm_manual_order_payment(text, uuid, text);
drop function if exists public.cancel_manual_order(text, text, uuid);
drop function if exists public.delete_or_archive_category(uuid, uuid);
drop function if exists public.adjust_product_variant_stock(uuid, text, integer, text, text, text);
drop function if exists public.delete_or_archive_admin_product(uuid, boolean);
drop function if exists public.save_admin_product(uuid, jsonb, jsonb, jsonb);

drop table if exists public.inventory_movements;

alter table public.store_settings
  drop column if exists previous_home_banner,
  drop column if exists home_banner;

alter table public.products
  drop column if exists images_confirmed;

alter table public.categories
  drop column if exists archived_at,
  drop column if exists image_url,
  drop column if exists description;

alter table public.categories drop constraint if exists categories_slug_format_check;
alter table public.categories
  add constraint categories_slug_check
  check (slug in ('tenis', 'calcas', 'conjuntos', 'camisetas', 'moletons', 'calcas-shorts'));

commit;
