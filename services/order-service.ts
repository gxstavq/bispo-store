import type { CartItem, CheckoutData, StoreOrder } from "@/types/commerce";

export async function createOrder(
  items: CartItem[],
  customer: CheckoutData,
  idempotencyKey: string,
): Promise<StoreOrder> {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ items, customer }),
  });
  const result = await response.json() as StoreOrder & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Não foi possível criar o pedido.");
  return result;
}

export async function createPaymentCheckout(orderId: string): Promise<{
  checkoutId: string;
  paymentUrl: string;
}> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-checkout`, {
    method: "POST",
  });
  const result = await response.json() as {
    checkoutId?: string;
    paymentUrl?: string;
    error?: string;
  };
  if (!response.ok || !result.checkoutId || !result.paymentUrl) {
    throw new Error(result.error ?? "Não foi possível abrir o pagamento Sandbox.");
  }
  return { checkoutId: result.checkoutId, paymentUrl: result.paymentUrl };
}
