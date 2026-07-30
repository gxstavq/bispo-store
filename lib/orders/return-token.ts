import "server-only";

import { getIntegrationEncryptionKey } from "@/lib/integrations/config";
import { isValidOrderNumber } from "@/lib/orders/order-number";
import {
  createCapabilityToken,
  verifyCapabilityToken,
} from "@/lib/security/capability-token";

const RETURN_SCOPE = "pagbank-order-return-v1";

export function createOrderReturnToken(orderNumber: string) {
  if (!isValidOrderNumber(orderNumber)) throw new Error("Número de pedido inválido.");
  return createCapabilityToken(
    getIntegrationEncryptionKey(),
    RETURN_SCOPE,
    orderNumber,
  );
}

export function verifyOrderReturnToken(orderNumber: string, token: unknown) {
  if (!isValidOrderNumber(orderNumber)) return false;
  return verifyCapabilityToken(
    getIntegrationEncryptionKey(),
    RETURN_SCOPE,
    orderNumber,
    token,
  );
}
