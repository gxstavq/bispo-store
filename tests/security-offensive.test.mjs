import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { safeInternalPath, safeJsonForHtml } from "../lib/security/safe-values.ts";
import {
  pagBankWebhookSignature,
  validatePagBankWebhookSignature,
  verifyPagBankWebhookSignature,
} from "../services/pagbank/webhook-signature.ts";

const root = process.cwd();
const source = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("callback rejeita redirecionamento externo com barras e contrabarras", () => {
  assert.equal(safeInternalPath("/checkout", "/"), "/checkout");
  assert.equal(safeInternalPath("//evil.example", "/"), "/");
  assert.equal(safeInternalPath("/\\evil.example", "/"), "/");
  assert.equal(safeInternalPath("https://evil.example", "/"), "/");
});

test("JSON-LD neutraliza fechamento de script e separadores perigosos", () => {
  const serialized = safeJsonForHtml({
    name: "</script><script>alert(1)</script>",
    separator: "\u2028",
  });
  assert.doesNotMatch(serialized, /<\/script>/i);
  assert.match(serialized, /\\u003c\/script\\u003e/i);
  assert.match(serialized, /\\u2028/);
});

test("assinatura PagBank usa SHA-256 do token, hífen e corpo bruto", () => {
  const token = "token-sandbox-de-teste";
  const body = Buffer.from(
    '{\n  "id":"ORDE_TEST",\n  "status":"PAID",\n  "nome":"João"\n}\n',
    "utf8",
  );
  const signature = pagBankWebhookSignature(body, token);
  assert.equal(signature.length, 64);
  assert.equal(verifyPagBankWebhookSignature(body, signature, token), true);
  const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString("utf8"))), "utf8");
  assert.equal(verifyPagBankWebhookSignature(reformatted, signature, token), false);
  assert.equal(verifyPagBankWebhookSignature(body, null, token), false);
  assert.equal(verifyPagBankWebhookSignature(body, "not-hex", token), false);
  assert.deepEqual(
    validatePagBankWebhookSignature(body, signature, token),
    {
      valid: true,
      reason: "valid",
      receivedLength: 64,
      calculatedLength: 64,
    },
  );
  assert.equal(
    validatePagBankWebhookSignature(body, "0".repeat(64), token).reason,
    "signature_digest_mismatch",
  );
});

test("webhook rejeita assinatura antes de consultar banco ou PagBank", () => {
  const webhook = source("app", "api", "webhooks", "pagbank", "route.ts");
  const verification = webhook.indexOf("validatePagBankWebhookSignature");
  const reconciliation = webhook.indexOf("reconcilePagBankPayment({");
  assert.ok(verification > 0);
  assert.ok(reconciliation > verification);
  assert.match(webhook, /x-authenticity-token/i);
  assert.match(webhook, /status:\s*401/);
  assert.match(webhook, /request\.arrayBuffer\(\)/);
  assert.doesNotMatch(webhook, /request\.json\(\)|JSON\.stringify\(body\)/);
});

test("diagnóstico PagBank é Sandbox, server-side e exclusivo de administradores", () => {
  const route = source(
    "app", "api", "integrations", "pagbank", "checkouts", "[id]", "status", "route.ts",
  );
  const directRoute = source(
    "app", "api", "integrations", "pagbank", "orders", "[id]", "status", "route.ts",
  );
  const reconciliation = source("services", "pagbank", "reconciliation.ts");
  const config = source("lib", "integrations", "config.ts");
  assert.match(route, /getAdminSession/);
  assert.match(route, /assertSameOrigin/);
  assert.match(route, /pagbank-admin-reconciliation/);
  assert.match(route, /reconcilePagBankPayment/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /process\.env\.CONTEXT|Authorization|PAGBANK_TOKEN/);
  assert.match(directRoute, /getAdminSession/);
  assert.match(directRoute, /assertSameOrigin/);
  assert.match(directRoute, /reconcilePagBankDirectPayment/);
  assert.doesNotMatch(directRoute, /process\.env\.CONTEXT|Authorization|PAGBANK_TOKEN/);
  assert.match(reconciliation, /consultPagBankCheckout/);
  assert.match(config, /baseUrl: "https:\/\/sandbox\.api\.pagseguro\.com"/);
  assert.match(config, /sandboxOnly\("PAGBANK_ENV"\)/);
  const panel = source("components", "order-status-select.tsx");
  assert.match(panel, /Verificar pagamento no PagBank/);
  assert.match(panel, /\/api\/integrations\/pagbank\/orders\//);
});

test("webhook registra somente metadados seguros antes da validação", () => {
  const webhook = source("app", "api", "webhooks", "pagbank", "route.ts");
  const reconciliation = source("services", "pagbank", "reconciliation.ts");
  assert.match(webhook, /pagbank_webhook_observation/);
  assert.match(webhook, /received_at/);
  assert.match(webhook, /declared_body_bytes/);
  assert.match(webhook, /signature_present/);
  assert.match(webhook, /received_signature_length/);
  assert.match(webhook, /calculated_signature_length/);
  assert.match(webhook, /body_sha256/);
  assert.match(webhook, /randomUUID\(\)/);
  assert.match(webhook, /signatureValidation\.reason/);
  assert.doesNotMatch(webhook, /console\.(?:info|warn|error)\(rawBody/);
  assert.doesNotMatch(webhook, /authorization:/i);
  assert.doesNotMatch(reconciliation, /customer|card_number|security_code|authorization/i);
});

test("webhook não depende de CSRF, sessão ou rate limiting do navegador", () => {
  const webhook = source("app", "api", "webhooks", "pagbank", "route.ts");
  const proxy = source("proxy.ts");
  assert.doesNotMatch(webhook, /assertSameOrigin|requireAdmin|enforceRateLimit/);
  assert.match(webhook, /validatePagBankWebhookSignature/);
  assert.match(proxy, /NextResponse\.next/);
  assert.doesNotMatch(proxy, /api\/webhooks\/pagbank|redirect\(/);
});

test("mutações autenticadas têm origem e payload limitados", () => {
  const routes = [
    ["app", "api", "orders", "route.ts"],
    ["app", "api", "shipping", "quotes", "route.ts"],
    ["app", "api", "products", "route.ts"],
    ["app", "api", "products", "[id]", "route.ts"],
    ["app", "api", "products", "[id]", "actions", "route.ts"],
    ["app", "api", "admin", "settings", "route.ts"],
    ["app", "api", "admin", "uploads", "route.ts"],
    ["app", "api", "orders", "[id]", "route.ts"],
    ["app", "api", "admin", "orders", "[id]", "label", "route.ts"],
  ];
  for (const parts of routes) {
    const route = source(...parts);
    assert.match(route, /assertSameOrigin/, parts.join("/"));
  }
  assert.match(source("app", "api", "orders", "route.ts"), /readJsonBody/);
  assert.match(source("app", "api", "admin", "uploads", "route.ts"), /validImageSignature/);
});

test("checkout rejeita total zero e URL de pagamento não HTTPS", () => {
  const payment = source("services", "pagbank", "payment-service.ts");
  assert.match(payment, /total do pedido deve ser maior que zero/i);
  assert.match(payment, /url\.protocol === "https:"/);
  assert.match(payment, /currentPrice !== Number\(item\.unit_price\)/);
  assert.match(payment, /product_variants\.stock|Estoque insuficiente/);
});

test("falha posterior ao pedido não cria pedido duplicado no checkout", () => {
  const checkout = source("components", "checkout-form.tsx");
  assert.match(checkout, /createdOrderId/);
  assert.match(checkout, /createdOrderId \|\| \(await createOrder/);
  assert.match(checkout, /pedido-recebido\?pedido=\$\{orderId\}&pagamento=pendente/);
});

test("sessões usam cookies HttpOnly e atualização no servidor", () => {
  const server = source("lib", "supabase", "server.ts");
  const proxy = source("proxy.ts");
  const layout = source("app", "layout.tsx");
  assert.match(server, /httpOnly:\s*true/);
  assert.match(server, /sameSite:\s*"lax"/);
  assert.match(proxy, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(layout, /SupabaseSessionRefresher/);
});

test("migration aplica rate limiting e recompõe menor privilégio", () => {
  const migration = source("supabase", "migrations", "20260729120000_security_hardening.sql");
  assert.match(migration, /consume_api_rate_limit/);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on table[\s\S]*from anon, authenticated/i);
  assert.match(migration, /order_items_positive_unit_price/);
  assert.match(migration, /order_items_quantity_limit/);
});

test("build desativa source maps públicos e envia cabeçalhos defensivos", () => {
  const nextConfig = source("next.config.ts");
  assert.match(nextConfig, /productionBrowserSourceMaps:\s*false/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /Permissions-Policy/);
});
