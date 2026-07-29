insert into public.categories (slug, name, active, sort_order)
values
  ('tenis', 'Tênis', true, 10),
  ('calcas', 'Calças', true, 20),
  ('conjuntos', 'Conjuntos', true, 30),
  ('camisetas', 'Camisetas (arquivada)', false, 90),
  ('moletons', 'Moletons (arquivada)', false, 91),
  ('calcas-shorts', 'Calças & shorts (arquivada)', false, 92)
on conflict (slug) do update set
  name = excluded.name,
  active = excluded.active,
  sort_order = excluded.sort_order;

insert into public.store_settings (
  singleton,
  store_name,
  owner_name,
  origin_address,
  origin_postal_code,
  whatsapp,
  commercial_email
) values (
  true,
  'Bispo Store',
  'Diogo',
  'Avenida São Miguel, 5046',
  '03870-100',
  '5511972938269',
  'bispostorebr@hotmail.com'
)
on conflict (singleton) do update set
  store_name = excluded.store_name,
  owner_name = excluded.owner_name,
  origin_address = excluded.origin_address,
  origin_postal_code = excluded.origin_postal_code,
  whatsapp = excluded.whatsapp,
  commercial_email = excluded.commercial_email;
