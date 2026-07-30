begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'admin_users', 'categories', 'products', 'product_images', 'product_variants',
        'customers', 'addresses', 'orders', 'order_items', 'shipping_quotes',
        'shipping_decisions', 'payments', 'payment_events', 'shipment_labels',
        'order_status_history', 'store_settings', 'audit_logs',
        'integration_credentials', 'oauth_states', 'integration_errors',
        'inventory_reservations'
      ])
  ),
  'RLS está habilitado em todas as tabelas da aplicação'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cliente-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cliente-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'admin@example.test', '', now(), '{}', '{}', now(), now());

insert into public.admin_users(user_id, email, active)
values ('10000000-0000-0000-0000-000000000003', 'admin@example.test', true);

insert into public.categories(id, slug, name, active)
values ('20000000-0000-0000-0000-000000000001', 'tenis', 'Tênis', true)
on conflict (slug) do update set active = true;

insert into public.products(
  id, category_id, name, slug, code, price, status, shipping_enabled
) values
  ('30000000-0000-0000-0000-000000000001', (select id from public.categories where slug = 'tenis'), 'Produto público', 'rls-publico', 'RLS-PUB', 100, 'active', true),
  ('30000000-0000-0000-0000-000000000002', (select id from public.categories where slug = 'tenis'), 'Produto rascunho', 'rls-rascunho', 'RLS-DRAFT', 100, 'draft', true);

insert into public.product_variants(id, product_id, sku, size, color, stock)
values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'RLS-PUB-40', '40', 'Preto', 5);

insert into public.customers(id, user_id, full_name, whatsapp, email) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cliente A', '551100000001', 'cliente-a@example.test'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Cliente B', '551100000002', 'cliente-b@example.test');
insert into public.addresses(id, customer_id, postal_code, street, number, district, city, state) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '01000-000', 'Rua A', '1', 'Centro', 'São Paulo', 'SP'),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '01000-001', 'Rua B', '2', 'Centro', 'São Paulo', 'SP');
insert into public.orders(
  id, order_number, customer_id, address_id, status, delivery_choice,
  subtotal, payment_status, shipping_status
) values
  ('70000000-0000-0000-0000-000000000001', 'RLS-A', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'awaiting_payment', 'shipping_quote', 100, 'awaiting_payment', 'selected'),
  ('70000000-0000-0000-0000-000000000002', 'RLS-B', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'awaiting_payment', 'shipping_quote', 100, 'awaiting_payment', 'selected');

set local role anon;
select is((select count(*)::integer from public.products), 1, 'visitante vê somente produto publicado');
select throws_ok('select * from public.orders', '42501', null, 'visitante não acessa pedidos');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from public.customers), 1, 'cliente vê somente o próprio cadastro');
select is((select count(*)::integer from public.addresses), 1, 'cliente vê somente o próprio endereço');
select is((select count(*)::integer from public.orders), 1, 'cliente vê somente o próprio pedido');
select is((select count(*)::integer from public.orders where order_number = 'RLS-B'), 0, 'cliente não vê pedido de outro cliente');
select is(
  (with changed as (update public.orders set status = 'paid' where order_number = 'RLS-A' returning 1) select count(*)::integer from changed),
  0,
  'cliente não altera status do próprio pedido'
);
select is(
  (with changed as (update public.products set price = 1 where id = '30000000-0000-0000-0000-000000000001' returning 1) select count(*)::integer from changed),
  0,
  'cliente não altera preços'
);
select is((select count(*)::integer from public.audit_logs), 0, 'cliente não visualiza auditoria');
select throws_ok(
  'select * from public.integration_credentials',
  '42501',
  null,
  'cliente não acessa tokens OAuth cifrados'
);
select throws_ok(
  'select * from public.oauth_states',
  '42501',
  null,
  'cliente não acessa estados OAuth'
);
select is((select count(*)::integer from public.integration_errors), 0, 'cliente não visualiza erros internos');
select throws_ok(
  $$select * from public.confirm_pagbank_payment('checkout', 'paid', 'PIX', 'PAID')$$,
  '42501',
  null,
  'cliente não pode confirmar pagamentos'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from public.customers), 2, 'administrador vê todos os clientes');
select is((select count(*)::integer from public.addresses), 2, 'administrador vê todos os endereços');
select is((select count(*)::integer from public.orders), 2, 'administrador vê todos os pedidos');
select is(
  (with changed as (update public.products set price = 110 where id = '30000000-0000-0000-0000-000000000001' returning 1) select count(*)::integer from changed),
  1,
  'administrador altera preço e a operação é autorizada'
);

select * from finish();
rollback;
