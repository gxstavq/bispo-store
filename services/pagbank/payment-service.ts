import "server-only";

import { createHash } from "node:crypto";
import { getPagBankConfig } from "@/lib/integrations/config";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  createPagBankCheckoutRequest,
  PagBankApiError,
  type PagBankCheckout,
} from "@/services/pagbank/client";
import { pagBankShippingServiceType } from "@/services/pagbank/shipping";
import {
  releaseOrderStockReservation,
  reserveOrderStock,
  stockReservationExpiration,
} from "@/services/inventory/reservation-service";
import { recordIntegrationError } from "@/services/integration-errors";
import { pagBankReturnUrl } from "@/lib/orders/order-number";
import { createOrderReturnToken } from "@/lib/orders/return-token";

type OrderForPayment = {
  id: string;
  order_number: string;
  status: string;
  delivery_choice: string;
  subtotal: number | string;
  shipping_amount: number | string | null;
  shipping_status: string;
  payment_status: string;
  customers: { full_name: string; email: string; whatsapp: string } | Array<{ full_name: string; email: string; whatsapp: string }>;
  addresses: {
    postal_code: string; street: string; number: string; district: string; city: string; state: string;
  } | Array<{
    postal_code: string; street: string; number: string; district: string; city: string; state: string;
  }>;
  order_items: Array<{
    product_id: string;
    variant_id: string;
    quantity: number;
    unit_price: number | string;
    product_snapshot: { name?: string };
    products: { price: number | string; promotional_price: number | string | null; status: string };
    product_variants: { stock: number; active: boolean };
  }>;
  selected_quote: { service_name: string; delivery_days: number | null } | Array<{ service_name: string; delivery_days: number | null }> | null;
};

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function securePaymentUrl(checkout: PagBankCheckout) {
  const value = checkout.links?.find((link) => link.rel === "PAY")?.href;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function pagBankIdempotencyKey(orderId: string, attempt: number) {
  return createHash("sha256").update(`pagbank:sandbox:checkout:${orderId}:v1:${attempt}`).digest("hex");
}

function checkoutPayload(order: OrderForPayment, expirationDate: string) {
  const config = getPagBankConfig();
  const address = one(order.addresses);
  const shippingAmount = Number(order.shipping_amount);
  const selectedQuote = order.selected_quote
    ? one(order.selected_quote)
    : null;
  const serviceType = shippingAmount > 0
    ? pagBankShippingServiceType(selectedQuote?.service_name)
    : undefined;
  const returnUrl = pagBankReturnUrl(
    config.redirectUrl,
    order.order_number,
    createOrderReturnToken(order.order_number),
  );
  return {
    reference_id: order.order_number,
    items: order.order_items.map((item) => ({
      name: item.product_snapshot.name ?? "Produto Bispo Store",
      quantity: item.quantity,
      unit_amount: cents(Number(item.unit_price)),
    })),
    shipping: {
      type: shippingAmount === 0 ? "FREE" : "FIXED",
      ...(serviceType ? { service_type: serviceType } : {}),
      ...(shippingAmount > 0 ? { amount: cents(shippingAmount) } : {}),
      address: {
        country: "BRA",
        region_code: address.state,
        city: address.city,
        postal_code: address.postal_code.replace(/\D/g, ""),
        street: address.street,
        number: address.number,
        locality: address.district,
      },
      address_modifiable: false,
      ...(selectedQuote?.delivery_days != null
        ? { estimated_delivery_time_in_days: selectedQuote.delivery_days }
        : {}),
    },
    payment_methods: [
      { type: "CREDIT_CARD" },
      { type: "DEBIT_CARD" },
      { type: "PIX" },
      { type: "BOLETO" },
    ],
    redirect_url: returnUrl,
    return_url: returnUrl,
    notification_urls: [config.notificationUrl],
    payment_notification_urls: [config.notificationUrl],
    expiration_date: expirationDate,
  };
}

function validateOrderForPayment(order: OrderForPayment) {
  if (order.shipping_amount === null) throw new Error("O frete precisa estar definido antes do pagamento.");
  const shippingAmount = Number(order.shipping_amount);
  if (!Number.isFinite(shippingAmount) || shippingAmount < 0 || shippingAmount > 1_000_000) {
    throw new Error("O valor do frete é inválido.");
  }
  if (order.delivery_choice === "local_delivery_review" && order.shipping_status !== "free_approved") {
    throw new Error("A entrega local ainda não foi aprovada.");
  }
  if (order.delivery_choice === "shipping_quote" && order.shipping_status !== "selected") {
    throw new Error("Selecione uma cotação válida antes do pagamento.");
  }
  let trustedSubtotal = 0;
  for (const item of order.order_items) {
    const currentPrice = Number(item.products.promotional_price ?? item.products.price);
    if (item.products.status !== "active" || !item.product_variants.active) {
      throw new Error("Um produto do pedido não está mais disponível.");
    }
    if (item.product_variants.stock < item.quantity) throw new Error("Estoque insuficiente.");
    if (currentPrice !== Number(item.unit_price)) {
      throw new Error("Os preços do pedido mudaram. Refaça o pedido antes de pagar.");
    }
    trustedSubtotal += currentPrice * item.quantity;
  }
  if (cents(trustedSubtotal) !== cents(Number(order.subtotal))) {
    throw new Error("O subtotal do pedido não confere com o catálogo.");
  }
  const total = trustedSubtotal + shippingAmount;
  if (!Number.isFinite(total) || cents(total) <= 0) {
    throw new Error("O total do pedido deve ser maior que zero.");
  }
  return total;
}

export async function createPagBankCheckoutForOrder(orderNumber: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id, order_number, status, delivery_choice, subtotal, shipping_amount,
      shipping_status, payment_status,
      customers!inner(full_name, email, whatsapp),
      addresses!inner(postal_code, street, number, district, city, state),
      order_items!inner(
        product_id, variant_id, quantity, unit_price, product_snapshot,
        products!inner(price, promotional_price, status),
        product_variants!inner(stock, active)
      ),
      selected_quote:shipping_quotes!orders_selected_shipping_quote_id_fkey(service_name, delivery_days)
    `)
    .eq("order_number", orderNumber)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Pedido não encontrado.");
  const order = data as unknown as OrderForPayment;
  const total = validateOrderForPayment(order);
  const { data: previousPayments } = await supabase
    .from("payments")
    .select("id, checkout_id, payment_url, status, expires_at")
    .eq("order_id", order.id)
    .eq("provider", "pagbank")
    .order("created_at", { ascending: false });
  const existing = previousPayments?.[0];
  if (existing && ["creating", "creation_uncertain"].includes(existing.status)) {
    throw new Error("Já existe uma criação de checkout em andamento. Aguarde ou revise o erro no painel.");
  }
  if (existing?.checkout_id && existing.payment_url) {
    const reusable = ["pending", "in_analysis", "paid"].includes(existing.status)
      && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now());
    if (reusable) {
      if (existing.status !== "paid") {
        await reserveOrderStock(
          order.id,
          existing.expires_at ?? stockReservationExpiration(),
        );
      }
      return {
        checkoutId: existing.checkout_id,
        paymentUrl: existing.payment_url,
        status: existing.status,
        expiresAt: existing.expires_at,
        reused: true,
      };
    }
  }
  const idempotencyKey = pagBankIdempotencyKey(order.id, (previousPayments?.length ?? 0) + 1);
  const checkoutExpiresAt = stockReservationExpiration();
  await reserveOrderStock(order.id, checkoutExpiresAt);

  const { data: payment, error: insertError } = await supabase.from("payments").insert({
    order_id: order.id,
    provider: "pagbank",
    amount: total,
    status: "creating",
    idempotency_key: idempotencyKey,
    provider_payload: { environment: "sandbox", request_started: true },
  }).select("id").single();
  if (insertError) {
    const { data: concurrent } = await supabase
      .from("payments")
      .select("checkout_id, payment_url, status, expires_at")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (concurrent?.checkout_id && concurrent.payment_url) {
      return {
        checkoutId: concurrent.checkout_id,
        paymentUrl: concurrent.payment_url,
        status: concurrent.status,
        expiresAt: concurrent.expires_at,
        reused: true,
      };
    }
    throw new Error("A criação idempotente do pagamento já está em andamento.");
  }

  let checkoutCreated = false;
  try {
    const response = await createPagBankCheckoutRequest(
      checkoutPayload(order, checkoutExpiresAt),
      idempotencyKey,
    );
    const paymentUrl = securePaymentUrl(response);
    if (!response.id || !paymentUrl) throw new Error("O PagBank não retornou checkout_id e link PAY.");
    checkoutCreated = true;
    const { error: updateError } = await supabase.from("payments").update({
      checkout_id: response.id,
      payment_url: paymentUrl,
      status: "pending",
      raw_status: response.status ?? "ACTIVE",
      expires_at: response.expiration_date ?? null,
      external_reference: response.id,
      provider_payload: response,
    }).eq("id", payment.id);
    if (updateError) {
      await supabase.from("payments").update({
        status: "creation_uncertain",
        last_error: "Checkout criado no PagBank, mas não persistido integralmente.",
      }).eq("id", payment.id);
      throw new Error("Checkout criado, mas a confirmação local falhou. Não tente novamente automaticamente.");
    }
    await supabase.from("orders").update({
      status: "awaiting_payment",
      payment_status: "awaiting_payment",
    }).eq("id", order.id);
    await supabase.from("payment_events").insert({
      payment_id: payment.id,
      provider: "pagbank",
      event_type: "checkout_created",
      provider_event_id: `checkout-created-${response.id}`,
      provider_status: response.status ?? "ACTIVE",
      verified: true,
      payload: { checkout_id: response.id, environment: "sandbox" },
    });
    return {
      checkoutId: response.id,
      paymentUrl,
      status: "pending",
      expiresAt: response.expiration_date,
      reused: false,
    };
  } catch (error) {
    const uncertain = checkoutCreated || !(error instanceof PagBankApiError);
    await supabase.from("payments").update({
      status: uncertain ? "creation_uncertain" : "creation_failed",
      last_error: error instanceof Error ? error.message : "Falha desconhecida.",
    }).eq("id", payment.id);
    if (!uncertain) {
      try {
        await releaseOrderStockReservation(order.id, "pagbank_checkout_creation_failed");
      } catch (releaseError) {
        await recordIntegrationError({
          provider: "pagbank",
          operation: "release_stock_reservation",
          orderId: order.id,
          retryable: true,
          message: releaseError instanceof Error
            ? releaseError.message
            : "Falha desconhecida ao liberar a reserva.",
          safeContext: { orderNumber },
        });
      }
    }
    await recordIntegrationError({
      provider: "pagbank",
      operation: "create_checkout",
      orderId: order.id,
      retryable: !uncertain,
      errorCode: error instanceof PagBankApiError ? String(error.status) : undefined,
      message: error instanceof Error ? error.message : "Falha desconhecida.",
      safeContext: { orderNumber },
    });
    throw error;
  }
}

export function extractPagBankPaymentUrl(checkout: PagBankCheckout) {
  return securePaymentUrl(checkout);
}
