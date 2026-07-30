export type PagBankWebhookIdentifiers = {
  checkoutId?: string;
  referenceId?: string;
};

function identifier(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

export function pagBankWebhookIdentifiers(body: Record<string, unknown>) {
  const identifiers: PagBankWebhookIdentifiers = {
    checkoutId: identifier(body.checkout_id, 80),
    referenceId: identifier(body.reference_id, 64),
  };
  if (!identifiers.checkoutId && !identifiers.referenceId) {
    throw new Error("O webhook não informou checkout_id nem reference_id.");
  }
  return identifiers;
}
