import "server-only";

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
  sandboxOnly("PAGBANK_ENV");
  return {
    baseUrl: "https://sandbox.api.pagseguro.com",
    token: required("PAGBANK_TOKEN"),
    notificationUrl: required("PAGBANK_NOTIFICATION_URL"),
    redirectUrl: required("PAGBANK_REDIRECT_URL"),
  };
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
  return {
    melhorEnvioSandbox: process.env.MELHOR_ENVIO_ENV === "sandbox",
    melhorEnvioConfigured: Boolean(
      process.env.MELHOR_ENVIO_CLIENT_ID
      && process.env.MELHOR_ENVIO_CLIENT_SECRET
      && process.env.MELHOR_ENVIO_REDIRECT_URI
      && process.env.MELHOR_ENVIO_ENV === "sandbox",
    ),
    pagBankSandbox: process.env.PAGBANK_ENV === "sandbox",
    pagBankConfigured: Boolean(
      process.env.PAGBANK_TOKEN
      && process.env.PAGBANK_NOTIFICATION_URL
      && process.env.PAGBANK_REDIRECT_URL
      && process.env.PAGBANK_ENV === "sandbox",
    ),
    labelPurchaseEnabled: isMelhorEnvioLabelPurchaseEnabled(),
  };
}
