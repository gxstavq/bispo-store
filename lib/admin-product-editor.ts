export function normalizeAdminToken(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function uniqueAdminTokens(values: string[]) {
  const seen = new Set<string>();
  return values.map(normalizeAdminToken).filter((value) => {
    const key = value.toLocaleLowerCase("pt-BR");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseAdminDecimal(value: string) {
  const input = value.trim().replace(/\s/g, "");
  if (!input) return null;
  const lastComma = input.lastIndexOf(",");
  const lastDot = input.lastIndexOf(".");
  let normalized = input;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = input.split(thousandsSeparator).join("")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = input.replace(",", ".");
  }
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function formatAdminDecimal(value: number | undefined) {
  return value === undefined ? "" : value.toFixed(2).replace(".", ",");
}
