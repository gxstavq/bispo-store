import { NextRequest, NextResponse } from "next/server";
import { getPagBankEnvironment } from "@/lib/integrations/config";
import { isValidOrderNumber } from "@/lib/orders/order-number";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderRepository } from "@/repositories/order-repository";
import {
  inactivatePagBankCheckout,
  PagBankApiError,
} from "@/services/pagbank/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  }
  try {
    assertSameOrigin(request);
    await enforceRateLimit({
      scope: "cancel-payment-checkout",
      identifier: user.id,
      limit: 5,
      windowSeconds: 60 * 60,
    });
  } catch (error) {
    return validationErrorResponse(error)
      ?? NextResponse.json({ error: "Não foi possível validar a solicitação." }, { status: 503 });
  }

  const { id } = await params;
  if (!isValidOrderNumber(id)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const visibleOrder = await orderRepository.findById(id);
  if (!visibleOrder) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  const service = createSupabaseServiceClient();
  const { data: order, error: orderError } = await service
    .from("orders")
    .select("id, status, payment_status")
    .eq("order_number", id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  const { data: payment, error: paymentError } = await service
    .from("payments")
    .select("id, checkout_id, status")
    .eq("order_id", order.id)
    .eq("provider", "pagbank")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) {
    return NextResponse.json({ error: "Não foi possível consultar o Checkout." }, { status: 503 });
  }
  if (
    order.status === "paid"
    || order.payment_status === "paid"
    || (payment && payment.status === "paid")
  ) {
    return NextResponse.json({ error: "Pagamento confirmado não pode ser inativado." }, { status: 409 });
  }
  if (order.status === "cancelled" && (!payment || payment.status === "cancelled")) {
    return NextResponse.json({ cancelled: true, duplicate: true });
  }

  if (payment?.checkout_id) {
    try {
      await inactivatePagBankCheckout(payment.checkout_id);
    } catch (error) {
      const status = error instanceof PagBankApiError ? error.status : 502;
      return NextResponse.json({
        error: status === 401 || status === 403
          ? "O PagBank recusou a inativação do Checkout."
          : "Não foi possível inativar o Checkout no PagBank.",
      }, { status: status === 401 || status === 403 ? 502 : 503 });
    }
  } else if (payment && !["creation_failed", "cancelled"].includes(payment.status)) {
    return NextResponse.json({
      error: "O estado do Checkout exige revisão antes do cancelamento.",
    }, { status: 409 });
  }

  const environment = getPagBankEnvironment().environment;
  if (payment) {
    const { error: paymentUpdateError } = await service
      .from("payments")
      .update({ status: "cancelled", raw_status: payment.checkout_id ? "INACTIVE" : "NOT_CREATED" })
      .eq("id", payment.id)
      .neq("status", "paid");
    if (paymentUpdateError) {
      return NextResponse.json({
        error: "O cancelamento local exige revisão administrativa.",
      }, { status: 500 });
    }
  }
  const { error: orderUpdateError } = await service
    .from("orders")
    .update({ status: "cancelled", payment_status: "cancelled", shipping_status: "cancelled" })
    .eq("id", order.id)
    .neq("payment_status", "paid");
  if (orderUpdateError) {
    return NextResponse.json({
      error: "Checkout inativado, mas o pedido exige revisão administrativa.",
    }, { status: 500 });
  }
  if (payment) {
    const eventKey = payment.checkout_id ?? payment.id;
    const { error: eventError } = await service.from("payment_events").insert({
      payment_id: payment.id,
      provider: "pagbank",
      event_type: payment.checkout_id ? "checkout_inactivated" : "checkout_not_created_cancelled",
      provider_event_id: `checkout-cancelled-${eventKey}`,
      provider_status: payment.checkout_id ? "INACTIVE" : "NOT_CREATED",
      verified: true,
      payload: {
        checkout_id: payment.checkout_id,
        environment,
        source: "customer_cancel",
      },
    });
    if (eventError?.code !== "23505" && eventError) {
      return NextResponse.json({
        cancelled: true,
        warning: "Pedido cancelado; o evento de auditoria exige revisão.",
      });
    }
  }
  return NextResponse.json({ cancelled: true, duplicate: false });
}
