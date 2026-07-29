import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

export interface MelhorEnvioCredential {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string;
  refreshExpiresAt?: string;
}

export async function readMelhorEnvioCredential(): Promise<MelhorEnvioCredential | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("access_token_encrypted, refresh_token_encrypted, token_type, scopes, expires_at, refresh_expires_at")
    .eq("provider", "melhor_envio")
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler credencial Melhor Envio: ${error.message}`);
  if (!data) return null;
  return {
    accessToken: decryptSecret(data.access_token_encrypted),
    refreshToken: decryptSecret(data.refresh_token_encrypted),
    tokenType: data.token_type,
    scopes: data.scopes ?? [],
    expiresAt: data.expires_at,
    refreshExpiresAt: data.refresh_expires_at ?? undefined,
  };
}

export async function saveMelhorEnvioCredential(
  credential: MelhorEnvioCredential,
  connectedBy?: string,
) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("integration_credentials").upsert({
    provider: "melhor_envio",
    access_token_encrypted: encryptSecret(credential.accessToken),
    refresh_token_encrypted: encryptSecret(credential.refreshToken),
    token_type: credential.tokenType,
    scopes: credential.scopes,
    expires_at: credential.expiresAt,
    refresh_expires_at: credential.refreshExpiresAt ?? null,
    connected_by: connectedBy ?? null,
    metadata: { environment: "sandbox" },
  }, { onConflict: "provider" });
  if (error) throw new Error(`Falha ao salvar credencial Melhor Envio: ${error.message}`);
}

export async function getMelhorEnvioConnectionStatus() {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("expires_at, refresh_expires_at, scopes, updated_at")
    .eq("provider", "melhor_envio")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? {
    connected: true,
    expiresAt: data.expires_at,
    refreshExpiresAt: data.refresh_expires_at,
    scopes: data.scopes ?? [],
    updatedAt: data.updated_at,
  } : { connected: false };
}
