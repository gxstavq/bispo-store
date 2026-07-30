import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { recordIntegrationError } from "@/services/integration-errors";
import {
  consultPagBankCheckout,
  normalizePagBankStatus,
  pagBankCheckoutTotalCents,
  type PagBankCheckout,
} from "@/services/pagbank/client";
import { consultedPagBankCheckoutMatchesPayment } from "@/services/pagbank/consistency";
import { pagBankTransactionSummary } from "@/services/pagbank/status";

export type PagBankReconciliationSource =
  | "webhook"
  | "admin_reconciliation"
  | "signed_return";

type PaymentRow = {
  id: string;
  order_id: string;
  checkout_id: string | null;
  amount: number | string;
  status: string;
  confirmed_at: string | null;
  orders: {
    order_number: string;
    total: number | string;
    status: string;
    payment_status: string;
    stock_deducted_at: string | null;
    stock_deduction_error: string | null;
  } | Array<{
    order_number: string;
    total: number | string;
    status: string;
    payment_status: string;
    stock_deducted_at: string | null;
    stock_deduction_error: string | null;
  }>;
};

type ConfirmationRow = {
  payment_id: string;
  order_id: string;
  stock_deducted: boolean;
  stock_error: string | null;
};

export class PagBankReconciliationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PagBankReconciliationError";
  }
}

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function safeEventId(checkout: PagBankCheckout) {
  const transaction = pagBankTransactionSummary(checkout);
  return createHash("sha256")
    .update([
      "pagbank-confirmed-state-v1",
      checkout.id,
      transaction.id ?? "checkout",
      transaction.status ?? checkout.status ?? "UNKNOWN",
    ].join("\0"))
    .digest("hex");
}

async function resolveStoredPayment(input: {
  checkoutId?: string;
  orderNumber?: string;
}) {
  if (!input.checkoutId && !input.orderNumber) {
    throw new PagBankReconciliationError(
      "Checkout ou pedido obrigatório.",
      400,
      "missing_identifier",
    );
  }
  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("payments")
    .select(`
      id, order_id, checkout_id, amount, status, confirmed_at,
      orders!inner(
        order_number, total, status, payment_status,
        stock_deducted_at, stock_deduction_error
      )
    `)
    .not("checkout_id", "is", null);
  if (input.checkoutId) {
    query = query.eq("checkout_id", input.checkoutId);
  } else {
    query = query.eq("orders.order_number", input.orderNumber);
  }
  const { data, error } = await query.limit(2);
  if (error) {
    throw new PagBankReconciliationError(
      "Não foi possível localizar o pagamento.",
      503,
      "payment_lookup_failed",
    );
  }
  if (!data?.length) {
    throw new PagBankReconciliationError(
      "Checkout desconhecido.",
      404,
      "payment_not_found",
    );
  }
  if (data.length !== 1) {
    throw new PagBankReconciliationError(
      "Checkout ambíguo.",
      409,
      "ambiguous_payment",
    );
  }
  const payment = data[0] as unknown as PaymentRow;
  const order = one(payment.orders);
  if (
    !payment.checkout_id
    || (input.orderNumber && input.orderNumber !== order.order_number)
  ) {
    throw new PagBankReconciliationError(
      "Checkout e pedido divergentes.",
      409,
      "stored_reference_mismatch",
    );
  }
  return { payment, order };
}

async function beginOfficialStateEvent(input: {
  paymentId: string;
  providerEventId: string;
  checkoutId: string;
  source: PagBankReconciliationSource;
  rawStatus: string;
  transactionId?: string;
}) {
  const supabase = createSupabaseServiceClient();
  const eventPayload = {
    checkout_id: input.checkoutId,
    source: input.source,
    consulted_status: input.rawStatus,
    transaction_id: input.transactionId ?? null,
  };
  const insertEvent = () => supabase
    .from("payment_events")
    .insert({
      payment_id: input.paymentId,
      provider: "pagbank",
      event_type: "payment_reconciliation_started",
      provider_event_id: input.providerEventId,
      provider_status: input.rawStatus,
      verified: false,
      payload: eventPayload,
    })
    .select("id")
    .single();

  let { data: event, error } = await insertEvent();
  if (error?.code !== "23505") {
    if (error || !event) {
      throw new PagBankReconciliationError(
        "Não foi possível registrar a reconciliação.",
        500,
        "event_insert_failed",
      );
    }
    return { eventId: event.id, duplicate: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("payment_events")
    .select("id, verified, received_at")
    .eq("provider", "pagbank")
    .eq("provider_event_id", input.providerEventId)
    .maybeSingle();
  if (existingError || !existing) {
    throw new PagBankReconciliationError(
      "Não foi possível verificar a idempotência.",
      503,
      "event_lookup_failed",
    );
  }
  if (existing.verified) {
    return { eventId: existing.id, duplicate: true };
  }

  const staleBefore = Date.now() - 2 * 60 * 1000;
  if (new Date(existing.received_at).getTime() >= staleBefore) {
    throw new PagBankReconciliationError(
      "A verificação deste pagamento já está em andamento.",
      409,
      "reconciliation_in_progress",
    );
  }
  const { error: staleDeleteError } = await supabase
    .from("payment_events")
    .delete()
    .eq("id", existing.id)
    .eq("verified", false);
  if (staleDeleteError) {
    throw new PagBankReconciliationError(
      "Não foi possível recuperar a reconciliação interrompida.",
      503,
      "stale_event_cleanup_failed",
    );
  }
  ({ data: event, error } = await insertEvent());
  if (error?.code === "23505") {
    throw new PagBankReconciliationError(
      "A verificação deste pagamento já está em andamento.",
      409,
      "reconciliation_in_progress",
    );
  }
  if (error || !event) {
    throw new PagBankReconciliationError(
      "Não foi possível reiniciar a reconciliação.",
      500,
      "event_retry_failed",
    );
  }
  return { eventId: event.id, duplicate: false };
}

async function finishOfficialStateEvent(input: {
  eventId: string;
  checkoutId: string;
  source: PagBankReconciliationSource;
  rawStatus: string;
  method?: string;
  transactionId?: string;
  applied: boolean;
}) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("payment_events")
    .update({
      event_type: input.source === "webhook"
        ? input.applied
          ? "webhook_verified"
          : "webhook_status_verified"
        : input.applied
          ? "payment_reconciliation_verified"
          : "payment_reconciliation_checked",
      provider_status: input.rawStatus,
      verified: true,
      verification_error: null,
      payload: {
        checkout_id: input.checkoutId,
        source: input.source,
        consulted_status: input.rawStatus,
        payment_method: input.method ?? null,
        transaction_id: input.transactionId ?? null,
        applied: input.applied,
      },
    })
    .eq("id", input.eventId);
  if (error) {
    throw new PagBankReconciliationError(
      "A confirmação foi processada, mas o evento de auditoria falhou.",
      500,
      "event_finalize_failed",
    );
  }
}

export async function reconcilePagBankPayment(input: {
  checkoutId?: string;
  orderNumber?: string;
  source: PagBankReconciliationSource;
  applyNonPaid?: boolean;
}) {
  const { payment, order } = await resolveStoredPayment(input);
  const checkout = await consultPagBankCheckout(payment.checkout_id!);
  const totalCents = pagBankCheckoutTotalCents(checkout);
  if (!consultedPagBankCheckoutMatchesPayment({
    checkoutId: checkout.id,
    referenceId: checkout.reference_id,
    totalCents,
    expectedCheckoutId: payment.checkout_id!,
    expectedOrderNumber: order.order_number,
    expectedAmount: payment.amount,
  })) {
    throw new PagBankReconciliationError(
      "Checkout, referência ou valor divergente.",
      409,
      "official_checkout_mismatch",
    );
  }

  const normalized = normalizePagBankStatus(checkout);
  const transaction = pagBankTransactionSummary(checkout);
  const providerEventId = safeEventId(checkout);
  const event = await beginOfficialStateEvent({
    paymentId: payment.id,
    providerEventId,
    checkoutId: payment.checkout_id!,
    source: input.source,
    rawStatus: normalized.rawStatus,
    transactionId: transaction.id,
  });

  if (event.duplicate) {
    const current = await resolveStoredPayment({
      checkoutId: payment.checkout_id!,
      orderNumber: order.order_number,
    });
    return {
      checkoutId: checkout.id,
      referenceId: checkout.reference_id!,
      checkoutStatus: checkout.status ?? null,
      paymentStatus: normalized.rawStatus,
      method: normalized.method ?? transaction.method ?? null,
      transactionId: transaction.id ?? null,
      checkoutCreatedAt: checkout.created_at ?? null,
      checkoutExpirationAt: checkout.expiration_date ?? null,
      transactionCreatedAt: transaction.createdAt ?? null,
      transactionUpdatedAt: transaction.updatedAt ?? null,
      paidAt: transaction.paidAt ?? null,
      totalCents,
      applied: false,
      duplicate: true,
      stockDeducted: Boolean(current.order.stock_deducted_at),
      stockDeductedAt: current.order.stock_deducted_at,
      stockError: current.order.stock_deduction_error,
      internalPaymentStatus: current.order.payment_status,
      confirmedAt: current.payment.confirmed_at,
    };
  }

  let confirmation: ConfirmationRow | null = null;
  const shouldApply = normalized.status === "paid" || input.applyNonPaid === true;
  const alreadyCompleted = payment.status === "paid" && Boolean(order.stock_deducted_at);
  try {
    if (shouldApply && !alreadyCompleted) {
      const supabase = createSupabaseServiceClient();
      const { data, error } = await supabase.rpc("confirm_pagbank_payment", {
        target_checkout_id: payment.checkout_id!,
        confirmed_status: normalized.status,
        confirmed_method: normalized.method ?? transaction.method ?? null,
        provider_raw_status: normalized.rawStatus,
      });
      if (error) throw new Error(error.message);
      confirmation = (Array.isArray(data) ? data[0] : data) as ConfirmationRow | null;
    }
    await finishOfficialStateEvent({
      eventId: event.eventId,
      checkoutId: payment.checkout_id!,
      source: input.source,
      rawStatus: normalized.rawStatus,
      method: normalized.method ?? transaction.method,
      transactionId: transaction.id,
      applied: shouldApply && !alreadyCompleted,
    });
  } catch (error) {
    const supabase = createSupabaseServiceClient();
    await supabase
      .from("payment_events")
      .delete()
      .eq("id", event.eventId)
      .eq("verified", false);
    await recordIntegrationError({
      provider: "pagbank",
      operation: "reconcile_payment",
      orderId: payment.order_id,
      retryable: true,
      message: error instanceof Error ? error.message : "Falha desconhecida.",
      safeContext: {
        checkoutId: payment.checkout_id,
        source: input.source,
      },
    });
    throw error;
  }

  const current = await resolveStoredPayment({
    checkoutId: payment.checkout_id!,
    orderNumber: order.order_number,
  });
  if (confirmation?.stock_error) {
    await recordIntegrationError({
      provider: "pagbank",
      operation: "stock_deduction",
      orderId: payment.order_id,
      retryable: false,
      message: confirmation.stock_error,
      safeContext: { checkoutId: payment.checkout_id },
    });
  }
  return {
    checkoutId: checkout.id,
    referenceId: checkout.reference_id!,
    checkoutStatus: checkout.status ?? null,
    paymentStatus: normalized.rawStatus,
    method: normalized.method ?? transaction.method ?? null,
    transactionId: transaction.id ?? null,
    checkoutCreatedAt: checkout.created_at ?? null,
    checkoutExpirationAt: checkout.expiration_date ?? null,
    transactionCreatedAt: transaction.createdAt ?? null,
    transactionUpdatedAt: transaction.updatedAt ?? null,
    paidAt: transaction.paidAt ?? null,
    totalCents,
    applied: shouldApply && !alreadyCompleted,
    duplicate: false,
    stockDeducted: confirmation?.stock_deducted
      ?? Boolean(current.order.stock_deducted_at),
    stockDeductedAt: current.order.stock_deducted_at,
    stockError: confirmation?.stock_error ?? current.order.stock_deduction_error,
    internalPaymentStatus: current.order.payment_status,
    confirmedAt: current.payment.confirmed_at,
  };
}
