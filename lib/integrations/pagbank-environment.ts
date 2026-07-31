export type PagBankEnvironment = "sandbox" | "production";

const PAGBANK_BASE_URLS: Record<PagBankEnvironment, string> = {
  sandbox: "https://sandbox.api.pagseguro.com",
  production: "https://api.pagseguro.com",
};

const PAGBANK_PAYMENT_HOSTS: Record<PagBankEnvironment, ReadonlySet<string>> = {
  production: new Set(["pagamento.pagseguro.uol.com.br"]),
  sandbox: new Set([
    "sandbox.pagseguro.uol.com.br",
    "sandbox.pagamento.pagseguro.uol.com.br",
    "qa.pagamento.pagseguro.uol.com.br",
  ]),
};

export function resolvePagBankEnvironment(value: string | undefined): {
  environment: PagBankEnvironment;
  baseUrl: string;
} {
  if (value !== "sandbox" && value !== "production") {
    throw new Error("PAGBANK_ENV deve ser sandbox ou production.");
  }
  return {
    environment: value,
    baseUrl: PAGBANK_BASE_URLS[value],
  };
}

export function isPagBankPaymentUrl(
  value: string,
  environment: PagBankEnvironment,
) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && PAGBANK_PAYMENT_HOSTS[environment].has(url.hostname);
  } catch {
    return false;
  }
}
