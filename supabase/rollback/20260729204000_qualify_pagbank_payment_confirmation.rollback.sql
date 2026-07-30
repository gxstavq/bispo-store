-- Rollback estrutural da migration 20260729204000.
-- Não remove nem altera dados; restaura a implementação anterior preservada.

begin;

revoke all on function public.confirm_pagbank_payment(text, text, text, text)
  from public, anon, authenticated, service_role;
drop function public.confirm_pagbank_payment(text, text, text, text);

alter function private.confirm_pagbank_payment_pre_20260729204000(
  text, text, text, text
) rename to confirm_pagbank_payment;
alter function private.confirm_pagbank_payment(text, text, text, text)
  set schema public;

revoke all on function public.confirm_pagbank_payment(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_pagbank_payment(text, text, text, text)
  to service_role;

commit;
