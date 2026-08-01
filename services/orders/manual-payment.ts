import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function confirmManualPagBankPayment(input: {
  orderNumber: string;
  actorUserId: string;
  note: string;
}) {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("confirm_manual_order_payment", {
    target_order_number: input.orderNumber,
    target_actor_user_id: input.actorUserId,
    confirmation_note: input.note,
  });
  if (error) throw new Error(error.message);
  const result = data as { duplicate?: boolean; stock_deducted?: boolean; stock_error?: string | null };
  return {
    duplicate: Boolean(result.duplicate),
    stockDeducted: Boolean(result.stock_deducted),
    stockError: result.stock_error ?? null,
  };
}

export async function cancelManualPaymentAndReleaseReservation(input: {
  orderNumber: string;
  actorUserId: string;
  note: string;
}) {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("cancel_manual_order", {
    target_order_number: input.orderNumber,
    target_actor_user_id: input.actorUserId,
    cancellation_note: input.note,
  });
  if (error) throw new Error(error.message);
  return data as { duplicate?: boolean; released?: number };
}
