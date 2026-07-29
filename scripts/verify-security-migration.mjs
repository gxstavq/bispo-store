import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const manifestPath = path.resolve(
  process.argv[2] ?? ".supabase-backups/2026-07-29-pre-security-hardening/manifest.json",
);

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Variáveis do Supabase ausentes.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonymous = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = {
  migrationArtifacts: {},
  preservedCounts: {},
  authUsers: 0,
};

for (const [table, before] of Object.entries(manifest.tables)) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Falha ao contar ${table}: ${error.message}`);
  if (count !== before) {
    throw new Error(`Contagem alterada em ${table}: antes=${before}, depois=${count}`);
  }
  results.preservedCounts[table] = count;
}

const { data: authData, error: authError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (authError) throw new Error(`Falha ao validar Auth: ${authError.message}`);
if (authData.users.length !== manifest.authUsers) {
  throw new Error("A quantidade de usuários Auth mudou após a migration.");
}
results.authUsers = authData.users.length;

const keyHash = randomBytes(32).toString("hex");
const rpcArguments = {
  requested_scope: "migration-check",
  requested_key_hash: keyHash,
  requested_limit: 1,
  requested_window_seconds: 60,
};
const first = await admin.rpc("consume_api_rate_limit", rpcArguments);
const second = await admin.rpc("consume_api_rate_limit", rpcArguments);
if (first.error || second.error || first.data?.[0]?.allowed !== true || second.data?.[0]?.allowed !== false) {
  throw new Error("O rate limiting atômico não produziu a sequência esperada.");
}
results.migrationArtifacts.serviceRoleRateLimit = true;

const anonymousAttempt = await anonymous.rpc("consume_api_rate_limit", rpcArguments);
if (!anonymousAttempt.error) {
  throw new Error("O papel anon conseguiu executar consume_api_rate_limit.");
}
results.migrationArtifacts.anonRateLimitBlocked = true;

console.log(JSON.stringify({
  result: "ok",
  migrationArtifacts: results.migrationArtifacts,
  authUsers: results.authUsers,
  preservedCounts: results.preservedCounts,
}, null, 2));
