begin;

revoke execute on function public.confirm_manual_order_payment(text, uuid, text)
  from authenticated;
revoke execute on function public.cancel_manual_order(text, text, uuid)
  from authenticated;

commit;
