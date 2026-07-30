export type PagBankWebhookIdentifiers = {
  checkoutId?: string;
  providerOrderId?: string;
  chargeId?: string;
  referenceId?: string;
};

function identifier(value: unknown, maxLength: number, prefix?: string) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  if (prefix && !normalized.toUpperCase().startsWith(`${prefix}_`)) return undefined;
  return normalized;
}

function firstChargeId(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  for (const charge of value) {
    if (!charge || typeof charge !== "object") continue;
    const id = identifier((charge as Record<string, unknown>).id, 80, "CHAR");
    if (id) return id;
  }
  return undefined;
}

export function pagBankWebhookIdentifiers(body: Record<string, unknown>) {
  const rootId = identifier(body.id, 80);
  const identifiers: PagBankWebhookIdentifiers = {
    checkoutId: identifier(body.checkout_id, 80, "CHEC"),
    providerOrderId: rootId?.toUpperCase().startsWith("ORDE_")
      ? rootId
      : undefined,
    chargeId: rootId?.toUpperCase().startsWith("CHAR_")
      ? rootId
      : firstChargeId(body.charges),
    referenceId: identifier(body.reference_id, 64),
  };
  if (!identifiers.referenceId && !identifiers.checkoutId) {
    throw new Error("O webhook não informou uma referência segura.");
  }
  if (identifiers.providerOrderId && !identifiers.referenceId) {
    throw new Error("O pedido PagBank não informou reference_id.");
  }
  return identifiers;
}
