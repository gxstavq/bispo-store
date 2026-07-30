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
import { pagBankWebhookIdentifiers } from "@/services/pagbank/webhook-association";
import {
  consultedPagBankCheckoutMatchesPayment,
  storedPagBankPaymentMatchesOrder,
} from "@/services/pagbank/consistency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookBody = {
  id?: string;
  checkout_id?: string;
  reference_id?: string;
  status?: string;
};

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

  let identifiers: ReturnType<typeof pagBankWebhookIdentifiers>;
  try {
    identifiers = pagBankWebhookIdentifiers(body as Record<string, unknown>);
  } catch {
    return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  let paymentQuery = supabase
    .from("payments")
    .select("id, order_id, checkout_id, amount, orders!inner(order_number, total)")
    .not("checkout_id", "is", null);
  if (identifiers.checkoutId) {
    paymentQuery = paymentQuery.eq("checkout_id", identifiers.checkoutId);
  } else {
    paymentQuery = paymentQuery.eq("orders.order_number", identifiers.referenceId);
  }
  const { data: matchingPayments, error: paymentError } = await paymentQuery.limit(2);
  if (paymentError) {
    return NextResponse.json({ error: "Não foi possível localizar o checkout." }, { status: 503 });
  }
  if (!matchingPayments?.length) {
    return NextResponse.json({ error: "Checkout desconhecido." }, { status: 404 });
  }
  if (matchingPayments.length !== 1) {
    return NextResponse.json({ error: "Webhook ambíguo." }, { status: 409 });
  }
  const payment = matchingPayments[0];
  if (!payment.checkout_id) {
    return NextResponse.json({ error: "Checkout desconhecido." }, { status: 404 });
  }
  const orderRelation = payment.orders as unknown as
    | { order_number: string; total: number | string }
    | Array<{ order_number: string; total: number | string }>;
  const order = Array.isArray(orderRelation) ? orderRelation[0] : orderRelation;
  const orderNumber = order?.order_number;
  if (!storedPagBankPaymentMatchesOrder({
    paymentAmount: payment.amount,
    orderTotal: order?.total ?? Number.NaN,
    orderNumber,
    webhookReferenceId: identifiers.referenceId,
  })) {
    return NextResponse.json({ error: "Pedido, referência ou valor divergente." }, { status: 409 });
  }

  const eventId = createHash("sha256")
    .update(`pagbank:${payment.checkout_id}:${rawBody}`)
    .digest("hex");
  const { data: duplicateEvent } = await supabase
    .from("payment_events")
    .select("id")
    .eq("provider", "pagbank")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  if (duplicateEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const safePayload = {
    checkout_id: payment.checkout_id,
    webhook_reference_id: identifiers.referenceId ?? null,
    webhook_status: body.status ?? null,
  };

  try {
    // A notificação nunca é fonte de verdade: o checkout é consultado no PagBank.
    const checkout = await consultPagBankCheckout(payment.checkout_id);
    if (!consultedPagBankCheckoutMatchesPayment({
      checkoutId: checkout.id,
      referenceId: checkout.reference_id,
      totalCents: pagBankCheckoutTotalCents(checkout),
      expectedCheckoutId: payment.checkout_id,
      expectedOrderNumber: orderNumber,
      expectedAmount: payment.amount,
    })) {
      return NextResponse.json({ error: "Checkout, referência ou valor divergente." }, { status: 409 });
    }

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
    await recordIntegrationError({
      provider: "pagbank",
      operation: "verify_webhook",
      orderId: payment.order_id,
      retryable: true,
      message,
      safeContext: { checkoutId: payment.checkout_id },
    });
    return NextResponse.json({ error: "Não foi possível verificar a notificação." }, { status: 502 });
  }
}
