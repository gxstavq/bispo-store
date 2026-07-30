-- Rollback estrutural e não destrutivo da migration 20260729203000.
-- Mantém a correção de qualificação em reserve_order_stock para não reintroduzir
-- o SQLSTATE 42702. Nenhuma tabela, coluna, reserva ou pedido é removido.

begin;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon, authenticated;
drop function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
);

alter function private.create_customer_order_unreserved_idempotent(
  jsonb, jsonb, jsonb, text, text, uuid, text
) rename to create_customer_order;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set schema public;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) to authenticated;
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set statement_timeout = '5s';

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
drop function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
);

alter function private.create_customer_order_unreserved_legacy(
  jsonb, jsonb, jsonb, text, text, uuid
) rename to create_customer_order;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set schema public;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) to authenticated;
alter function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set statement_timeout = '5s';

commit;
