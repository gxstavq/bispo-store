import "server-only";

import { getPagBankConfig } from "@/lib/integrations/config";
export { normalizePagBankStatus, pagBankCheckoutTotalCents } from "./status";

type FetchImplementation = typeof fetch;

export type PagBankLink = {
  rel: string;
  href: string;
  method?: string;
};

export type PagBankCheckout = {
  id: string;
  reference_id?: string;
  status?: string;
  created_at?: string;
  expiration_date?: string;
  items?: Array<{ name?: string; quantity?: number; unit_amount?: number }>;
  shipping?: { amount?: number; type?: string };
  additional_amount?: number;
  discount_amount?: number;
  payments?: Array<Record<string, unknown>>;
  charges?: Array<Record<string, unknown>>;
  links?: PagBankLink[];
};

export type NormalizedPagBankStatus = {
  status: "paid" | "pending" | "declined" | "expired" | "cancelled";
  rawStatus: string;
  method?: string;
};

export class PagBankApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "PagBankApiError";
  }
}

async function pagBankRequest<T>(
  path: string,
  init: RequestInit,
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getPagBankConfig();
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error_messages" in payload
      ? JSON.stringify(payload.error_messages)
      : "Falha na comunicação com o PagBank.";
    throw new PagBankApiError(message, response.status, payload);
  }
  return payload as T;
}

export function createPagBankCheckoutRequest(
  payload: Record<string, unknown>,
  idempotencyKey: string,
  fetchImpl: FetchImplementation = fetch,
) {
  return pagBankRequest<PagBankCheckout>("/checkouts", {
    method: "POST",
    headers: { "x-idempotency-key": idempotencyKey },
    body: JSON.stringify(payload),
  }, fetchImpl);
}

export function consultPagBankCheckout(
  checkoutId: string,
  fetchImpl: FetchImplementation = fetch,
) {
  return pagBankRequest<PagBankCheckout>(
    `/checkouts/${encodeURIComponent(checkoutId)}`,
    { method: "GET" },
    fetchImpl,
  );
}
