import "server-only";

import {
  resolvePagBankEnvironment,
  type PagBankEnvironment,
} from "@/lib/integrations/pagbank-environment";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Integração não configurada: ${name}.`);
  return value;
}

function sandboxOnly(name: string) {
  const value = required(name);
  if (value !== "sandbox") {
    throw new Error(`${name} deve permanecer como sandbox até aprovação manual.`);
  }
  return value;
}

function requiredHttpsUrl(name: string) {
  const value = required(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Integração configurada com URL inválida: ${name}.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`Integração configurada com URL insegura: ${name}.`);
  }
  return url;
}

function assertProductionPagBankUrl(name: string, url: URL, pathname: string) {
  if (
    url.origin !== "https://bispostorebr.com.br"
    || url.pathname.replace(/\/$/u, "") !== pathname
    || url.search
    || url.hash
  ) {
    throw new Error(`${name} deve usar a URL oficial da Bispo Store em produção.`);
  }
}

export function getMelhorEnvioConfig() {
  sandboxOnly("MELHOR_ENVIO_ENV");
  return {
    baseUrl: "https://sandbox.melhorenvio.com.br",
    clientId: required("MELHOR_ENVIO_CLIENT_ID"),
    clientSecret: required("MELHOR_ENVIO_CLIENT_SECRET"),
    redirectUri: required("MELHOR_ENVIO_REDIRECT_URI"),
    userAgent: process.env.INTEGRATION_USER_AGENT?.trim()
      || "Bispo Store (bispostorebr@hotmail.com)",
    originPostalCode: "03870100",
  };
}

export function getPagBankConfig() {
  const selected = getPagBankEnvironment();
  const notificationUrl = requiredHttpsUrl("PAGBANK_NOTIFICATION_URL");
  const redirectUrl = requiredHttpsUrl("PAGBANK_REDIRECT_URL");
  if (selected.environment === "production") {
    assertProductionPagBankUrl(
      "PAGBANK_NOTIFICATION_URL",
      notificationUrl,
      "/api/webhooks/pagbank",
    );
    assertProductionPagBankUrl(
      "PAGBANK_REDIRECT_URL",
      redirectUrl,
      "/pedido-recebido",
    );
  }
  return {
    ...selected,
    token: required("PAGBANK_TOKEN"),
    notificationUrl: notificationUrl.toString(),
    redirectUrl: redirectUrl.toString(),
  };
}

export function getPagBankEnvironment() {
  return resolvePagBankEnvironment(process.env.PAGBANK_ENV?.trim());
}

export function isMelhorEnvioLabelPurchaseEnabled() {
  return process.env.ENABLE_MELHOR_ENVIO_LABEL_PURCHASE === "true";
}

export function assertMelhorEnvioLabelPurchaseEnabled() {
  if (!isMelhorEnvioLabelPurchaseEnabled()) {
    throw new Error("A compra de etiquetas está desativada pela configuração fiscal.");
  }
}

export function getIntegrationEncryptionKey() {
  return required("INTEGRATION_ENCRYPTION_KEY");
}

export function safeIntegrationConfiguration() {
  let pagBankEnvironment: PagBankEnvironment | null = null;
  try {
    pagBankEnvironment = getPagBankEnvironment().environment;
  } catch {
    pagBankEnvironment = null;
  }
  return {
    melhorEnvioSandbox: process.env.MELHOR_ENVIO_ENV === "sandbox",
    melhorEnvioConfigured: Boolean(
      process.env.MELHOR_ENVIO_CLIENT_ID
      && process.env.MELHOR_ENVIO_CLIENT_SECRET
      && process.env.MELHOR_ENVIO_REDIRECT_URI
      && process.env.MELHOR_ENVIO_ENV === "sandbox",
    ),
    pagBankEnvironment,
    pagBankSandbox: pagBankEnvironment === "sandbox",
    pagBankConfigured: Boolean(
      process.env.PAGBANK_TOKEN
      && process.env.PAGBANK_NOTIFICATION_URL
      && process.env.PAGBANK_REDIRECT_URL
      && pagBankEnvironment,
    ),
    labelPurchaseEnabled: isMelhorEnvioLabelPurchaseEnabled(),
  };
}
