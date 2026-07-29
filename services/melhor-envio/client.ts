import "server-only";

import { getMelhorEnvioConfig, isMelhorEnvioLabelPurchaseEnabled } from "@/lib/integrations/config";
import {
  readMelhorEnvioCredential,
  saveMelhorEnvioCredential,
  type MelhorEnvioCredential,
} from "@/repositories/integration-credentials-repository";
import { shouldRefreshMelhorEnvioToken } from "./token-policy";
export { shouldRefreshMelhorEnvioToken } from "./token-policy";

type FetchImplementation = typeof fetch;

type TokenResponse = {
  token_type?: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
  scope?: string;
};

export type MelhorEnvioQuoteResponse = {
  id: number | string;
  name: string;
  custom_price?: string;
  custom_delivery_time?: number;
  company?: { id?: number; name?: string; picture?: string };
  error?: string;
};

export type MelhorEnvioProduct = {
  id: string;
  width: number;
  height: number;
  length: number;
  weight: number;
  insurance_value: number;
  quantity: number;
};

export class MelhorEnvioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "MelhorEnvioApiError";
  }
}

const quoteScopes = ["shipping-calculate"];
const labelScopes = [
  "cart-read", "cart-write", "orders-read", "shipping-checkout",
  "shipping-generate", "shipping-print", "shipping-tracking", "ecommerce-shipping",
];

export function melhorEnvioScopes() {
  return isMelhorEnvioLabelPurchaseEnabled()
    ? [...quoteScopes, ...labelScopes]
    : quoteScopes;
}

export function buildMelhorEnvioAuthorizationUrl(state: string) {
  const config = getMelhorEnvioConfig();
  const url = new URL("/oauth/authorize", config.baseUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", melhorEnvioScopes().join(" "));
  return url.toString();
}

function mapTokenResponse(response: TokenResponse): MelhorEnvioCredential {
  const now = Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type ?? "Bearer",
    scopes: response.scope?.split(/\s+/).filter(Boolean) ?? melhorEnvioScopes(),
    expiresAt: new Date(now + response.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(now + 45 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function tokenRequest(
  body: Record<string, string>,
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getMelhorEnvioConfig();
  const response = await fetchImpl(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.userAgent,
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Partial<TokenResponse> & { message?: string };
  if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new MelhorEnvioApiError(
      payload.message ?? "Falha na autenticação OAuth do Melhor Envio.",
      response.status,
      payload,
    );
  }
  return mapTokenResponse(payload as TokenResponse);
}

export async function exchangeMelhorEnvioAuthorizationCode(
  code: string,
  connectedBy: string,
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getMelhorEnvioConfig();
  const credential = await tokenRequest({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  }, fetchImpl);
  await saveMelhorEnvioCredential(credential, connectedBy);
  return credential;
}

export async function refreshMelhorEnvioCredential(
  credential: MelhorEnvioCredential,
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getMelhorEnvioConfig();
  if (credential.refreshExpiresAt && new Date(credential.refreshExpiresAt).getTime() <= Date.now()) {
    throw new MelhorEnvioApiError("A autorização do Melhor Envio expirou e precisa ser refeita.", 401);
  }
  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    refresh_token: credential.refreshToken,
  }, fetchImpl);
  await saveMelhorEnvioCredential(refreshed);
  return refreshed;
}

async function validCredential(fetchImpl: FetchImplementation, forceRefresh = false) {
  const credential = await readMelhorEnvioCredential();
  if (!credential) throw new MelhorEnvioApiError("Melhor Envio ainda não foi autorizado no painel.", 401);
  return forceRefresh || shouldRefreshMelhorEnvioToken(credential.expiresAt)
    ? refreshMelhorEnvioCredential(credential, fetchImpl)
    : credential;
}

async function authorizedRequest<T>(
  path: string,
  init: RequestInit,
  fetchImpl: FetchImplementation = fetch,
  retry = true,
): Promise<T> {
  const config = getMelhorEnvioConfig();
  const credential = await validCredential(fetchImpl);
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": config.userAgent,
      Authorization: `${credential.tokenType} ${credential.accessToken}`,
      ...init.headers,
    },
    cache: "no-store",
  });
  if (response.status === 401 && retry) {
    await validCredential(fetchImpl, true);
    return authorizedRequest<T>(path, init, fetchImpl, false);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "message" in payload
      ? String(payload.message)
      : "Falha na comunicação com o Melhor Envio.";
    throw new MelhorEnvioApiError(message, response.status, payload);
  }
  return payload as T;
}

export async function calculateMelhorEnvioShipping(
  destinationPostalCode: string,
  products: MelhorEnvioProduct[],
  fetchImpl: FetchImplementation = fetch,
) {
  const config = getMelhorEnvioConfig();
  return authorizedRequest<MelhorEnvioQuoteResponse[]>(
    "/api/v2/me/shipment/calculate",
    {
      method: "POST",
      body: JSON.stringify({
        from: { postal_code: config.originPostalCode },
        to: { postal_code: destinationPostalCode.replace(/\D/g, "") },
        products,
        options: { receipt: false, own_hand: false },
      }),
    },
    fetchImpl,
  );
}

export function melhorEnvioRequest<T>(
  path: string,
  init: RequestInit,
  fetchImpl: FetchImplementation = fetch,
) {
  return authorizedRequest<T>(path, init, fetchImpl);
}
