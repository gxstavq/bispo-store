import "server-only";

import { createHmac } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { getIntegrationEncryptionKey } from "@/lib/integrations/config";
import { RequestValidationError } from "./request";

function opaqueKey(scope: string, identifier: string) {
  return createHmac("sha256", getIntegrationEncryptionKey())
    .update(`${scope}\0${identifier}`)
    .digest("hex");
}

export async function enforceRateLimit(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    requested_scope: input.scope,
    requested_key_hash: opaqueKey(input.scope, input.identifier),
    requested_limit: input.limit,
    requested_window_seconds: input.windowSeconds,
  });
  if (error) throw new Error(`Rate limiting indisponível: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    throw new RequestValidationError("Muitas tentativas. Aguarde antes de tentar novamente.", 429);
  }
  return row;
}
