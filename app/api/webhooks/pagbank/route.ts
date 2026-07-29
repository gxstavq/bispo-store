import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPagBankConfig } from "@/lib/integrations/config";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  consultPagBankCheckout,
  normalizePagBankStatus,
  pagBankCheckoutTotalCents,
} from "@/services/pagbank/client";
import { recordIntegrationError } from "@/services/integration-errors";
import { verifyPagBankWebhookSignature } from "@/services/pagbank/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookBody = {
  id?: string;
  checkout_id?: string;
  reference_id?: string;
  status?: string;
};

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 262_144) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > 262_144) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  let pagBankToken: string;
  try {
    pagBankToken = getPagBankConfig().token;
  } catch {
    return NextResponse.json({ error: "Webhook indisponível." }, { status: 503 });
  }
  if (!verifyPagBankWebhookSignature(
    rawBody,
    request.headers.get("x-authenticity-token"),
    pagBankToken,
  )) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const hintedCheckoutId = body.checkout_id ?? body.id;
  let paymentQuery = supabase
    .from("payments")
    .select("id, order_id, checkout_id, amount, orders!inner(order_number)");
  if (hintedCheckoutId) {
    paymentQuery = paymentQuery.eq("checkout_id", hintedCheckoutId);
  } else if (body.reference_id) {
    paymentQuery = paymentQuery.eq("orders.order_number", body.reference_id);
  } else {
    return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
  }
  const { data: payment, error: paymentError } = await paymentQuery.maybeSingle();
  if (paymentError || !payment?.checkout_id) {
    return NextResponse.json({ error: "Checkout desconhecido." }, { status: 404 });
  }

  const eventId = createHash("sha256")
    .update(`pagbank:${payment.checkout_id}:${rawBody}`)
    .digest("hex");
  const safePayload = {
    checkout_id: payment.checkout_id,
    webhook_reference_id: body.reference_id ?? null,
    webhook_status: body.status ?? null,
  };
  const { data: event, error: eventError } = await supabase.from("payment_events").insert({
    payment_id: payment.id,
    provider: "pagbank",
    event_type: "webhook_received",
    provider_event_id: eventId,
    provider_status: body.status ?? null,
    verified: false,
    payload: safePayload,
  }).select("id").single();
  if (eventError?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (eventError || !event) {
    return NextResponse.json({ error: "Evento não persistido." }, { status: 500 });
  }

  try {
    // A notificação nunca é fonte de verdade: o checkout é consultado no PagBank.
    const checkout = await consultPagBankCheckout(payment.checkout_id);
    const orderRelation = payment.orders as unknown as
      | { order_number: string }
      | Array<{ order_number: string }>;
    const orderNumber = Array.isArray(orderRelation)
      ? orderRelation[0]?.order_number
      : orderRelation?.order_number;
    if (!orderNumber || checkout.reference_id !== orderNumber) {
      throw new Error("A referência consultada não corresponde ao pedido.");
    }
    if (pagBankCheckoutTotalCents(checkout) !== cents(Number(payment.amount))) {
      throw new Error("O total consultado no PagBank não corresponde ao total do servidor.");
    }

    const normalized = normalizePagBankStatus(checkout);
    const { data: confirmation, error: confirmationError } = await supabase.rpc(
      "confirm_pagbank_payment",
      {
        target_checkout_id: payment.checkout_id,
        confirmed_status: normalized.status,
        confirmed_method: normalized.method ?? null,
        provider_raw_status: normalized.rawStatus,
      },
    );
    if (confirmationError) throw new Error(confirmationError.message);
    const confirmationRow = Array.isArray(confirmation) ? confirmation[0] : confirmation;

    await supabase.from("payment_events").update({
      event_type: "webhook_verified",
      provider_status: normalized.rawStatus,
      verified: true,
      verification_error: null,
      payload: {
        ...safePayload,
        consulted_status: normalized.rawStatus,
        payment_method: normalized.method ?? null,
      },
    }).eq("id", event.id);

    if (confirmationRow?.stock_error) {
      await recordIntegrationError({
        provider: "pagbank",
        operation: "stock_deduction",
        orderId: payment.order_id,
        retryable: false,
        message: confirmationRow.stock_error,
        safeContext: { checkoutId: payment.checkout_id },
      });
    }
    return NextResponse.json({ received: true, verified: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de verificação desconhecida.";
    await supabase.from("payment_events").update({
      verification_error: message,
      verified: false,
    }).eq("id", event.id);
    await recordIntegrationError({
      provider: "pagbank",
      operation: "verify_webhook",
      orderId: payment.order_id,
      retryable: true,
      message,
      safeContext: { checkoutId: payment.checkout_id, eventId },
    });
    return NextResponse.json({ error: "Não foi possível verificar a notificação." }, { status: 502 });
  }
}
