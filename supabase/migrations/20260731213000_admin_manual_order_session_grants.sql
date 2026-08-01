-- Permite que as duas RPCs manuais usem a sessão do administrador autenticado.
-- As próprias funções continuam exigindo auth.uid() igual ao ator e admin ativo.

begin;

grant execute on function public.confirm_manual_order_payment(text, uuid, text)
  to authenticated;
grant execute on function public.cancel_manual_order(text, text, uuid)
  to authenticated;

commit;
