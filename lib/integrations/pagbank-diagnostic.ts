import "server-only";

import { getIntegrationEncryptionKey } from "@/lib/integrations/config";
import {
  createCapabilityToken,
  verifyCapabilityToken,
} from "@/lib/security/capability-token";

const DIAGNOSTIC_SCOPE = "pagbank-checkout-diagnostic-v1";
const MAX_AGE_MS = 5 * 60 * 1000;

export function createPagBankDiagnosticToken(checkoutId: string, timestamp: number) {
  return createCapabilityToken(
    getIntegrationEncryptionKey(),
    `${DIAGNOSTIC_SCOPE}:${timestamp}`,
    checkoutId,
  );
}

export function verifyPagBankDiagnosticToken(
  checkoutId: string,
  timestampValue: unknown,
  token: unknown,
) {
  const timestamp = Number(timestampValue);
  if (
    !Number.isSafeInteger(timestamp)
    || Math.abs(Date.now() - timestamp) > MAX_AGE_MS
  ) {
    return false;
  }
  return verifyCapabilityToken(
    getIntegrationEncryptionKey(),
    `${DIAGNOSTIC_SCOPE}:${timestamp}`,
    checkoutId,
    token,
  );
}
