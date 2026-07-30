export type PagBankCheckoutStatusInput = {
  status?: string;
  items?: Array<{ quantity?: number; unit_amount?: number }>;
  shipping?: { amount?: number };
  additional_amount?: number;
  discount_amount?: number;
  payments?: Array<Record<string, unknown>>;
  charges?: Array<Record<string, unknown>>;
};

function nestedString(value: unknown, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "string" && current) return current;
  }
  return undefined;
}

export function normalizePagBankStatus(checkout: PagBankCheckoutStatusInput) {
  const transaction = checkout.payments?.[0] ?? checkout.charges?.[0];
  const rawStatus = String(nestedString(transaction, [["status"]]) ?? checkout.status ?? "UNKNOWN").toUpperCase();
  const method = nestedString(transaction, [
    ["payment_method", "type"],
    ["payment_method"],
    ["method", "type"],
  ]);
  if (["PAID", "APPROVED"].includes(rawStatus)) return { status: "paid" as const, rawStatus, method };
  if (rawStatus === "IN_ANALYSIS") return { status: "in_analysis" as const, rawStatus, method };
  if (["DECLINED", "DENIED"].includes(rawStatus)) return { status: "declined" as const, rawStatus, method };
  if (rawStatus === "EXPIRED") return { status: "expired" as const, rawStatus, method };
  if (["CANCELED", "CANCELLED"].includes(rawStatus)) return { status: "cancelled" as const, rawStatus, method };
  return { status: "pending" as const, rawStatus, method };
}

export function pagBankCheckoutTotalCents(checkout: PagBankCheckoutStatusInput) {
  const items = (checkout.items ?? []).reduce(
    (sum, item) => sum + Number(item.unit_amount ?? 0) * Number(item.quantity ?? 0),
    0,
  );
  return items + Number(checkout.shipping?.amount ?? 0)
    + Number(checkout.additional_amount ?? 0) - Number(checkout.discount_amount ?? 0);
}
