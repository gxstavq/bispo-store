import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  ".netlify",
  ".supabase-backups",
  ".codex",
  ".openai",
  "Fotos Bispo Store",
]);
const extensions = /\.(?:ts|tsx|js|mjs|cjs|css|html|json|map|sql|env|example|log|md|toml|yaml|yml|ps1|bat|sh)$/;

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const file = join(directory, name);
    return statSync(file).isDirectory() ? files(file) : extensions.test(name) ? [file] : [];
  });
}

const auditedRoots = ["app", "components", "services", "lib", "repositories", "payments", "public"];
for (const file of auditedRoots.flatMap((directory) => files(join(root, directory)))) {
  const source = readFileSync(file, "utf8");
  const label = relative(root, file);
  assert.doesNotMatch(
    source,
    /NEXT_PUBLIC_(?:PAGBANK|MELHOR_ENVIO|SUPABASE_SERVICE_ROLE|INTEGRATION_ENCRYPTION)/i,
    `${label}: segredo público`,
  );
  assert.doesNotMatch(
    source,
    /https:\/\/api\.pagseguro\.com|https:\/\/melhorenvio\.com\.br\/api/i,
    `${label}: endpoint de produção`,
  );
  if (!label.endsWith(".env.example")) {
    assert.doesNotMatch(
      source,
      /(?:PAGBANK_TOKEN|MELHOR_ENVIO_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["'][^"']+["']/i,
      `${label}: segredo literal`,
    );
  }
}

const allCandidateFiles = files(root).filter((file) => !file.endsWith(".env.local"));
const genericSecretPatterns = [
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, "possível token GitHub"],
  [/\bsbp_[A-Za-z0-9_-]{30,}\b/, "possível token Supabase"],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}\b/, "possível segredo Supabase"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "chave privada"],
  [/\b(?:sk|pk)_live_[A-Za-z0-9_-]{16,}\b/, "possível chave de produção"],
];
for (const file of allCandidateFiles) {
  const source = readFileSync(file, "utf8");
  const label = relative(root, file);
  for (const [pattern, description] of genericSecretPatterns) {
    assert.doesNotMatch(source, pattern, `${label}: ${description}`);
  }
}

const secretNames = [
  "PAGBANK_TOKEN",
  "MELHOR_ENVIO_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTEGRATION_ENCRYPTION_KEY",
  "STORE_CNPJ",
];
for (const name of secretNames) {
  const value = process.env[name]?.trim();
  if (!value) continue;
  for (const file of allCandidateFiles) {
    assert.ok(
      !readFileSync(file, "utf8").includes(value),
      `${relative(root, file)} contém o valor de ${name}`,
    );
  }
}

const browserSourceMaps = files(join(root, "public")).filter((file) => file.endsWith(".map"));
assert.equal(browserSourceMaps.length, 0, "public não deve conter source maps");

const env = readFileSync(join(root, ".env.example"), "utf8");
for (const name of secretNames) {
  assert.match(env, new RegExp(`^${name}=$`, "m"), `${name} deve permanecer vazio`);
}
for (const line of env.split(/\r?\n/)) {
  if (!line.trim()) continue;
  assert.match(line, /^[A-Z][A-Z0-9_]*=$/, ".env.example deve conter apenas nomes vazios");
}

console.log("Auditoria de segurança concluída: arquivos versionáveis sem segredos públicos ou literais.");
