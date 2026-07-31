export type PagBankProviderAssociation = {
  providerOrderId?: string;
  providerChargeId?: string;
};

const ORDER_ID = /^ORDE_[A-Z0-9-]{12,80}$/i;
const CHARGE_ID = /^CHAR_[A-Z0-9-]{12,80}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerId(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function chargeIdFrom(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((item) => providerId(record(item)?.id, CHARGE_ID))
    .filter((id): id is string => Boolean(id));
  return new Set(ids).size === 1 ? ids[0] : undefined;
}

export function isPagBankOrderId(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID.test(value);
}

export function isPagBankChargeId(value: unknown): value is string {
  return typeof value === "string" && CHARGE_ID.test(value);
}

export function storedPagBankProviderAssociation(
  payload: unknown,
): PagBankProviderAssociation {
  const data = record(payload);
  if (!data) return {};
  return {
    providerOrderId: providerId(
      data.verified_order_id ?? data.provider_order_id,
      ORDER_ID,
    ),
    providerChargeId: providerId(
      data.verified_charge_id ?? data.provider_charge_id,
      CHARGE_ID,
    ),
  };
}

export function checkoutPagBankProviderAssociation(
  checkout: Record<string, unknown>,
  expectedReferenceId: string,
): PagBankProviderAssociation {
  const candidates = [
    ...(Array.isArray(checkout.orders) ? checkout.orders : []),
    ...(Array.isArray(checkout.payments) ? checkout.payments : []),
  ].map(record).filter((item): item is Record<string, unknown> => Boolean(item));

  const matching = candidates.filter((candidate) => {
    const referenceId = candidate.reference_id;
    return referenceId === undefined || referenceId === expectedReferenceId;
  });
  const orderIds = matching
    .map((candidate) => providerId(candidate.id, ORDER_ID))
    .filter((id): id is string => Boolean(id));
  const chargeIds = matching.flatMap((candidate) => {
    const direct = providerId(candidate.id, CHARGE_ID);
    const nested = chargeIdFrom(candidate.charges);
    return [direct, nested].filter((id): id is string => Boolean(id));
  });

  const uniqueOrders = [...new Set(orderIds)];
  const uniqueCharges = [...new Set(chargeIds)];
  return {
    providerOrderId: uniqueOrders.length === 1 ? uniqueOrders[0] : undefined,
    providerChargeId: uniqueCharges.length === 1 ? uniqueCharges[0] : undefined,
  };
}
