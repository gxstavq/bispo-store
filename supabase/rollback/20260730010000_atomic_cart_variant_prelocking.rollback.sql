-- Rollback estrutural da migration 20260730010000.
-- Deve ser executado em conjunto com a reversão do código que chama
-- replace_product_variants. Não remove tabelas, colunas ou registros.

begin;

revoke all on function public.replace_product_variants(uuid, jsonb)
  from public, anon, authenticated, service_role;
drop function public.replace_product_variants(uuid, jsonb);

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon, authenticated;
drop function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
);

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
drop function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
);

alter function private.create_customer_order_pre_20260730010000_idempotent(
  jsonb, jsonb, jsonb, text, text, uuid, text
) rename to create_customer_order;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) set schema public;

alter function private.create_customer_order_pre_20260730010000_legacy(
  jsonb, jsonb, jsonb, text, text, uuid
) rename to create_customer_order;
alter function private.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) set schema public;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid, text
) to authenticated;

revoke all on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.create_customer_order(
  jsonb, jsonb, jsonb, text, text, uuid
) to authenticated;

drop function private.lock_and_validate_cart_inventory(jsonb);

alter function public.confirm_pagbank_payment(text, text, text, text)
  reset lock_timeout;
alter function public.confirm_pagbank_payment(text, text, text, text)
  reset statement_timeout;

commit;
