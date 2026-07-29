import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function recordIntegrationError(input: {
  provider: "melhor_envio" | "pagbank";
  operation: string;
  orderId?: string;
  retryable?: boolean;
  errorCode?: string;
  message: string;
  safeContext?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceClient();
  await supabase.from("integration_errors").insert({
    provider: input.provider,
    operation: input.operation,
    order_id: input.orderId ?? null,
    retryable: input.retryable ?? false,
    error_code: input.errorCode ?? null,
    error_message: input.message.slice(0, 1000),
    safe_context: input.safeContext ?? {},
  });
}
