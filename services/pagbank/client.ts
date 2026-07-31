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
  orders?: Array<Record<string, unknown>>;
  charges?: Array<Record<string, unknown>>;
  links?: PagBankLink[];
};

export type PagBankCharge = {
  id: string;
  reference_id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  paid_at?: string;
  amount?: {
    value?: number;
    currency?: string;
    summary?: {
      total?: number;
      paid?: number;
      refunded?: number;
    };
  };
  payment_method?: {
    type?: string;
  } | string;
  links?: PagBankLink[];
};

export type PagBankOrder = {
  id: string;
  reference_id?: string;
  created_at?: string;
  charges?: PagBankCharge[];
  links?: PagBankLink[];
};

export type NormalizedPagBankStatus = {
  status: "paid" | "pending" | "in_analysis" | "declined" | "expired" | "cancelled";
  rawStatus: string;
  method?: string;
};

export class PagBankApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
    public readonly endpoint?: string,
    public readonly attempts = 1,
    public readonly timedOut = false,
  ) {
    super(message);
    this.name = "PagBankApiError";
  }
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const CONSULTATION_TIMEOUT_MS = 8_000;
const MAX_CONSULTATION_RETRIES = 2;

function retryDelay(attempt: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, 200 * attempt);
  });
}

async function pagBankRequest<T>(
  path: string,
  init: RequestInit,
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getPagBankConfig();
  const maxRetries = init.method === "GET" ? MAX_CONSULTATION_RETRIES : 0;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONSULTATION_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
          ...init.headers,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload as T;
      if (RETRYABLE_STATUS.has(response.status) && attempt <= maxRetries) {
        await retryDelay(attempt);
        continue;
      }
      const message = typeof payload === "object" && payload && "error_messages" in payload
        ? JSON.stringify(payload.error_messages)
        : "Falha na comunicação com o PagBank.";
      throw new PagBankApiError(
        message,
        response.status,
        payload,
        path,
        attempt,
      );
    } catch (error) {
      if (error instanceof PagBankApiError) throw error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      if (attempt <= maxRetries) {
        await retryDelay(attempt);
        continue;
      }
      throw new PagBankApiError(
        timedOut
          ? "A consulta ao PagBank excedeu o tempo limite."
          : "Falha temporária na comunicação com o PagBank.",
        504,
        undefined,
        path,
        attempt,
        timedOut,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new PagBankApiError(
    "Falha temporária na comunicação com o PagBank.",
    503,
    undefined,
    path,
    maxRetries + 1,
  );
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

export function consultPagBankOrder(
  orderId: string,
  fetchImpl: FetchImplementation = fetch,
) {
  return pagBankRequest<PagBankOrder>(
    `/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" },
    fetchImpl,
  );
}

export function consultPagBankCharge(
  chargeId: string,
  fetchImpl: FetchImplementation = fetch,
) {
  return pagBankRequest<PagBankCharge>(
    `/charges/${encodeURIComponent(chargeId)}`,
    { method: "GET" },
    fetchImpl,
  );
}

export function consultPagBankOrderByCharge(
  chargeId: string,
  fetchImpl: FetchImplementation = fetch,
) {
  return pagBankRequest<PagBankOrder | { orders?: PagBankOrder[] }>(
    `/orders?charge_id=${encodeURIComponent(chargeId)}`,
    { method: "GET" },
    fetchImpl,
  );
}
