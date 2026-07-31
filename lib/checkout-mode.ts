export type CheckoutCompletionMode = "whatsapp" | "pagbank";

export function checkoutCompletionMode(): CheckoutCompletionMode {
  return process.env.CHECKOUT_COMPLETION_MODE === "pagbank" ? "pagbank" : "whatsapp";
}
