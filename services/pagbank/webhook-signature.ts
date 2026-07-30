import { createHash, timingSafeEqual } from "node:crypto";

export type PagBankWebhookSignatureReason =
  | "valid"
  | "missing_signature"
  | "invalid_signature_format"
  | "signature_length_mismatch"
  | "signature_digest_mismatch";

type RawWebhookBody = string | Uint8Array;

export function pagBankWebhookSignature(rawBody: RawWebhookBody, token: string) {
  const hash = createHash("sha256");
  hash.update(token, "utf8");
  hash.update("-", "utf8");
  hash.update(rawBody);
  return hash.digest("hex");
}

export function validatePagBankWebhookSignature(
  rawBody: RawWebhookBody,
  receivedSignature: string | null,
  token: string,
) {
  const expectedHex = pagBankWebhookSignature(rawBody, token);
  const receivedLength = receivedSignature?.length ?? 0;
  const calculatedLength = expectedHex.length;
  if (!receivedSignature) {
    return {
      valid: false,
      reason: "missing_signature" as PagBankWebhookSignatureReason,
      receivedLength,
      calculatedLength,
    };
  }
  if (!/^[a-f0-9]+$/i.test(receivedSignature)) {
    return {
      valid: false,
      reason: "invalid_signature_format" as PagBankWebhookSignatureReason,
      receivedLength,
      calculatedLength,
    };
  }
  if (receivedLength !== calculatedLength) {
    return {
      valid: false,
      reason: "signature_length_mismatch" as PagBankWebhookSignatureReason,
      receivedLength,
      calculatedLength,
    };
  }
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedSignature, "hex");
  const valid = timingSafeEqual(expected, received);
  return {
    valid,
    reason: (valid ? "valid" : "signature_digest_mismatch") as PagBankWebhookSignatureReason,
    receivedLength,
    calculatedLength,
  };
}

export function verifyPagBankWebhookSignature(
  rawBody: RawWebhookBody,
  receivedSignature: string | null,
  token: string,
) {
  return validatePagBankWebhookSignature(rawBody, receivedSignature, token).valid;
}
