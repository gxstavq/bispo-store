import type { CartItem, CheckoutData, StoreOrder } from "@/types/commerce";

export class CustomerAuthenticationRequiredError extends Error {
  constructor() {
    super("Entre com seu e-mail para criar e acompanhar o pedido.");
    this.name = "CustomerAuthenticationRequiredError";
  }
}

export async function createOrder(
  items: CartItem[],
  customer: CheckoutData,
): Promise<StoreOrder> {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, customer }),
  });
  const result = await response.json() as StoreOrder & { error?: string; loginRequired?: boolean };
  if (response.status === 401 && result.loginRequired) {
    throw new CustomerAuthenticationRequiredError();
  }
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
