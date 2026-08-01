import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const buildRoot = join(root, ".next");
const secretNames = [
  "PAGBANK_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MELHOR_ENVIO_CLIENT_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "STORE_CNPJ",
];

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
}

const localOnlyRoots = [join(buildRoot, "dev"), join(buildRoot, "cache")];
const buildFiles = files(buildRoot).filter((file) =>
  !localOnlyRoots.some((directory) => file.startsWith(`${directory}\\`) || file.startsWith(`${directory}/`)),
);
const publicBundleFiles = buildFiles.filter((file) =>
  file.startsWith(join(buildRoot, "static")),
);
const populatedSecrets = secretNames.flatMap((name) => {
  const value = process.env[name]?.trim();
  return value ? [{ name, value }] : [];
});
const matches = [];

for (const file of buildFiles) {
  const contents = readFileSync(file);
  for (const secret of populatedSecrets) {
    if (contents.includes(Buffer.from(secret.value))) {
      matches.push({ file: relative(root, file), secretName: secret.name });
    }
  }
}

const publicSourceMaps = publicBundleFiles.filter((file) => file.endsWith(".map"));
assert.deepEqual(matches, [], "o build contém um valor secreto configurado");
assert.deepEqual(publicSourceMaps, [], "o bundle público contém source maps");

console.log(JSON.stringify({
  result: "ok",
  buildFilesScanned: buildFiles.length,
  publicBundleFilesScanned: publicBundleFiles.length,
  populatedSecretsChecked: populatedSecrets.map(({ name }) => name),
  secretValueMatches: matches.length,
  publicSourceMaps: publicSourceMaps.length,
}, null, 2));
