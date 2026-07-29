import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { exchangeMelhorEnvioAuthorizationCode } from "@/services/melhor-envio/client";
import { recordIntegrationError } from "@/services/integration-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get("melhor_envio_oauth_state")?.value;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const redirect = (status: string) =>
    NextResponse.redirect(new URL(`/admin/configuracoes?integracao=${status}`, siteUrl));

  if (!session || !code || !state || !stateCookie || state !== stateCookie) {
    return redirect("melhor-envio-state-invalido");
  }

  const stateHash = createHash("sha256").update(state).digest("hex");
  const supabase = createSupabaseServiceClient();
  const { data: stateRow } = await supabase
    .from("oauth_states")
    .select("state_hash")
    .eq("state_hash", stateHash)
    .eq("admin_user_id", session.user.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!stateRow) return redirect("melhor-envio-state-expirado");

  await supabase.from("oauth_states").update({ used_at: new Date().toISOString() }).eq("state_hash", stateHash);
  try {
    await exchangeMelhorEnvioAuthorizationCode(code, session.user.id);
    const response = redirect("melhor-envio-conectado");
    response.cookies.delete("melhor_envio_oauth_state");
    return response;
  } catch (error) {
    await recordIntegrationError({
      provider: "melhor_envio",
      operation: "oauth_callback",
      retryable: true,
      message: error instanceof Error ? error.message : "Falha OAuth desconhecida.",
    });
    return redirect("melhor-envio-falhou");
  }
}
