import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { releaseOrderStockReservation } from "@/services/inventory/reservation-service";

const manualCheckoutId = (orderNumber: string) => `WHATSAPP:${orderNumber}`;

export async function confirmManualPagBankPayment(input: {
  orderNumber: string;
  actorUserId: string;
  note: string;
}) {
  const db = createSupabaseServiceClient();
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id, status, payment_status, subtotal, shipping_amount, stock_deducted_at")
    .eq("order_number", input.orderNumber)
    .single();
  if (orderError || !order) throw new Error("Pedido não encontrado.");
  if (order.payment_status === "paid" || order.status === "paid") {
    return { duplicate: true, stockDeducted: Boolean(order.stock_deducted_at), stockError: null };
  }
  if (order.status !== "awaiting_payment" || order.shipping_amount === null) {
    throw new Error("O pedido precisa estar aguardando pagamento e com o frete definido.");
  }

  const total = Math.round(
    (Number(order.subtotal) + Number(order.shipping_amount)) * 100,
  ) / 100;
  if (!Number.isFinite(total) || total <= 0) throw new Error("O total do pedido é inválido.");
  const checkoutId = manualCheckoutId(input.orderNumber);
  const { error: insertError } = await db.from("payments").insert({
    order_id: order.id,
    provider: "pagbank_manual",
    external_reference: input.orderNumber,
    checkout_id: checkoutId,
    amount: total,
    status: "pending",
    payment_method: "PagBank conferido manualmente",
    raw_status: "AWAITING_MANUAL_CONFIRMATION",
    provider_payload: {
      source: "whatsapp_manual_confirmation",
      confirmed_by: input.actorUserId,
    },
  });
  if (insertError?.code !== "23505" && insertError) throw new Error(insertError.message);

  const { data, error } = await db.rpc("confirm_pagbank_payment", {
    target_checkout_id: checkoutId,
    confirmed_status: "paid",
    confirmed_method: "PagBank conferido manualmente",
    provider_raw_status: "MANUALLY_CONFIRMED_BY_ADMIN",
  });
  if (error) throw new Error(`Não foi possível confirmar o pagamento: ${error.message}`);
  const result = Array.isArray(data) ? data[0] : data;

  const { data: payment, error: paymentError } = await db
    .from("payments")
    .select("id")
    .eq("checkout_id", checkoutId)
    .single();
  if (paymentError || !payment) throw new Error("Pagamento confirmado, mas o registro não foi localizado.");

  const { error: eventError } = await db.from("payment_events").insert({
    payment_id: payment.id,
    provider: "pagbank_manual",
    event_type: "manual_payment_confirmed_by_admin",
    provider_event_id: `manual-payment-confirmed-${order.id}`,
    provider_status: "PAID",
    verified: true,
    payload: {
      source: "admin_pagbank_app_check",
      confirmed_by: input.actorUserId,
    },
  });
  if (eventError?.code !== "23505" && eventError) throw new Error(eventError.message);

  const { data: history } = await db
    .from("order_status_history")
    .select("id")
    .eq("order_id", order.id)
    .eq("to_status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (history) {
    const { error: historyError } = await db
      .from("order_status_history")
      .update({ note: input.note, changed_by: input.actorUserId })
      .eq("id", history.id);
    if (historyError) throw new Error(historyError.message);
  } else {
    const { error: historyError } = await db.from("order_status_history").insert({
      order_id: order.id,
      from_status: "awaiting_payment",
      to_status: "paid",
      note: input.note,
      changed_by: input.actorUserId,
    });
    if (historyError) throw new Error(historyError.message);
  }

  return {
    duplicate: false,
    stockDeducted: Boolean(result?.stock_deducted),
    stockError: result?.stock_error ? String(result.stock_error) : null,
  };
}

export async function cancelManualPaymentAndReleaseReservation(orderId: string) {
  const db = createSupabaseServiceClient();
  const { error } = await db
    .from("payments")
    .update({ status: "cancelled", raw_status: "CANCELLED_BY_ADMIN" })
    .eq("order_id", orderId)
    .eq("provider", "pagbank_manual")
    .neq("status", "paid");
  if (error) throw new Error(error.message);
  await releaseOrderStockReservation(orderId, "admin_cancelled_whatsapp_order");
}
