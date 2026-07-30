import { createHmac, timingSafeEqual } from "node:crypto";

export function createCapabilityToken(key: string, scope: string, value: string) {
  if (!key || !scope || !value) throw new Error("Dados de assinatura incompletos.");
  return createHmac("sha256", key)
    .update(`${scope}\0${value}`, "utf8")
    .digest("hex");
}

export function verifyCapabilityToken(
  key: string,
  scope: string,
  value: string,
  received: unknown,
) {
  if (typeof received !== "string" || !/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = Buffer.from(createCapabilityToken(key, scope, value), "hex");
  const candidate = Buffer.from(received, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
