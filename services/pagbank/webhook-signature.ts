import { createHash, timingSafeEqual } from "node:crypto";

export function pagBankWebhookSignature(rawBody: string, token: string) {
  return createHash("sha256").update(`${token}-${rawBody}`, "utf8").digest("hex");
}

export function verifyPagBankWebhookSignature(
  rawBody: string,
  receivedSignature: string | null,
  token: string,
) {
  if (!receivedSignature || !/^[a-f0-9]{64}$/i.test(receivedSignature)) return false;
  const expected = Buffer.from(pagBankWebhookSignature(rawBody, token), "hex");
  const received = Buffer.from(receivedSignature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
