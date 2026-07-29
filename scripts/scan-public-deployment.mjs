import assert from "node:assert/strict";

const base = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
assert.equal(base.protocol, "https:", "a auditoria pública exige uma URL HTTPS");

const secrets = [
  "PAGBANK_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MELHOR_ENVIO_CLIENT_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "STORE_CNPJ",
].flatMap((name) => {
  const value = process.env[name]?.trim();
  return value ? [{ name, value }] : [];
});

const initialPaths = [
  "/",
  "/catalogo",
  "/checkout",
  "/admin",
  "/admin/dashboard",
  "/api/orders",
  "/api/admin/settings",
  "/api/products?includeInactive=true",
];
const queued = initialPaths.map((path) => new URL(path, base));
const visited = new Set();
const statuses = [];
let sourceMapsPublished = 0;

while (queued.length) {
  const url = queued.shift();
  if (!url || url.origin !== base.origin || visited.has(url.href)) continue;
  visited.add(url.href);
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  const body = await response.text();
  const searchable = `${body}\n${[...response.headers].map(([key, value]) => `${key}:${value}`).join("\n")}`;
  for (const secret of secrets) {
    assert.ok(!searchable.includes(secret.value), `${secret.name} exposto em ${url.pathname}`);
  }

  statuses.push({ path: `${url.pathname}${url.search}`, status: response.status });
  for (const match of body.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)) {
    const asset = new URL(match[1], base);
    if (asset.origin === base.origin) queued.push(asset);
  }
  for (const match of body.matchAll(/sourceMappingURL=([^\s*]+)/g)) {
    const mapUrl = new URL(match[1], url);
    if (mapUrl.origin !== base.origin) continue;
    const mapResponse = await fetch(mapUrl, { redirect: "manual", cache: "no-store" });
    if (mapResponse.ok) sourceMapsPublished += 1;
  }
}

assert.equal(sourceMapsPublished, 0, "source maps públicos foram encontrados");
console.log(JSON.stringify({
  result: "ok",
  resourcesScanned: visited.size,
  sourceMapsPublished,
  statuses,
}, null, 2));
