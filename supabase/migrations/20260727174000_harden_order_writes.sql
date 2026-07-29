-- Pedidos são criados somente pela função transacional create_customer_order.
-- Assim, clientes não podem forjar preço, frete, pagamento, status ou itens via REST.
drop policy if exists orders_own_insert on public.orders;
drop policy if exists order_items_own_insert on public.order_items;

revoke insert, update, delete on public.orders from authenticated;
revoke insert, update, delete on public.order_items from authenticated;
revoke insert, update, delete on public.shipping_quotes from authenticated;
revoke insert, update, delete on public.shipping_decisions from authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.payment_events from authenticated;
revoke insert, update, delete on public.shipment_labels from authenticated;
revoke insert, update, delete on public.order_status_history from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;

-- Administradores usam as mesmas conexões autenticadas. Os grants abaixo permitem
-- a operação, enquanto as políticas RLS continuam bloqueando não administradores.
grant insert, update, delete on public.orders to authenticated;
grant insert, update, delete on public.order_items to authenticated;
grant insert, update, delete on public.shipping_quotes to authenticated;
grant insert, update, delete on public.shipping_decisions to authenticated;
grant insert, update, delete on public.payments to authenticated;
grant insert, update, delete on public.payment_events to authenticated;
grant insert, update, delete on public.shipment_labels to authenticated;
grant insert, update, delete on public.order_status_history to authenticated;

-- Os privilégios são necessários para admins, mas sem políticas INSERT/UPDATE
-- próprias o cliente comum continua negado. A criação pública permanece apenas RPC.
