import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { buildMelhorEnvioAuthorizationUrl } from "@/services/melhor-envio/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireAdmin();
  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("oauth_states").insert({
    state_hash: stateHash,
    provider: "melhor_envio",
    admin_user_id: user.id,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: "Não foi possível iniciar a autorização." }, { status: 500 });
  }
  const response = NextResponse.redirect(buildMelhorEnvioAuthorizationUrl(state));
  response.cookies.set("melhor_envio_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
