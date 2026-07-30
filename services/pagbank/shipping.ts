export function pagBankShippingServiceType(serviceName?: string | null) {
  const normalized = serviceName?.trim().toUpperCase();
  return normalized === "PAC" || normalized === "SEDEX"
    ? normalized
    : undefined;
}
