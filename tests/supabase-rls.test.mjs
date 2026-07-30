import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const schema = readFileSync(join(root, "supabase", "migrations", "20260727170000_schema.sql"), "utf8");
const rls = readFileSync(join(root, "supabase", "migrations", "20260727171000_rls_storage.sql"), "utf8");
const orderFunctions = readFileSync(join(root, "supabase", "migrations", "20260727173000_order_functions.sql"), "utf8");
const hardening = readFileSync(join(root, "supabase", "migrations", "20260727174000_harden_order_writes.sql"), "utf8");
const integrations = readFileSync(join(root, "supabase", "migrations", "20260727175000_sandbox_integrations.sql"), "utf8");
const pagBankHardening = readFileSync(
  join(root, "supabase", "migrations", "20260729200000_pagbank_idempotency_inventory_reservations.sql"),
  "utf8",
);
const envExample = readFileSync(join(root, ".env.example"), "utf8");

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? sourceFiles(file) : [file];
  }).filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
}

const tables = [
  "admin_users", "products", "product_images", "product_variants", "categories",
  "customers", "addresses", "orders", "order_items", "shipping_quotes",
  "shipping_decisions", "payments", "payment_events", "shipment_labels",
  "order_status_history", "store_settings",
];

test("schema versionado contém todas as tabelas solicitadas", () => {
  for (const table of tables) {
    assert.match(schema, new RegExp(`create table public\\.${table}\\b`, "i"), table);
  }
  assert.match(schema, /create table public\.audit_logs\b/i);
});

test("RLS está habilitado e há isolamento por auth.uid para dados do cliente", () => {
  for (const table of [...tables, "audit_logs"]) {
    assert.match(rls, new RegExp(`alter table public\\.${table} enable row level security`, "i"), table);
  }
  assert.match(rls, /customers_own_read[\s\S]*auth\.uid\(\)/i);
  assert.match(rls, /orders_own_read[\s\S]*auth\.uid\(\)/i);
  assert.match(rls, /orders_admin_all[\s\S]*private\.is_admin/i);
  assert.match(rls, /audit_logs_admin_read[\s\S]*private\.is_admin/i);
});

test("escritas sensíveis ficam restritas a administradores ou à RPC segura", () => {
  assert.match(hardening, /drop policy if exists orders_own_insert/i);
  assert.match(hardening, /drop policy if exists order_items_own_insert/i);
  assert.match(orderFunctions, /security definer/i);
  assert.match(orderFunctions, /product_record\.promotional_price, product_record\.price/i);
  assert.match(orderFunctions, /variant_record\.stock < item_quantity/i);
  assert.match(orderFunctions, /revoke all on function public\.create_customer_order[\s\S]*from public, anon/i);
});

test("auditoria cobre preço, estoque, pedido, frete, pagamento e ciclo de produto", () => {
  for (const trigger of [
    "products_audit", "product_variants_audit", "orders_audit",
    "shipping_quotes_audit", "shipping_decisions_audit", "payments_audit",
  ]) assert.match(schema, new RegExp(`create trigger ${trigger}\\b`, "i"), trigger);
  assert.match(schema, /changed_fields/);
  assert.match(schema, /actor_user_id/);
  assert.match(schema, /audit_action := 'PUBLISH'/);
  assert.match(schema, /audit_action := 'ARCHIVE'/);
});

test("service role é exclusivamente servidor e não há valor secreto de exemplo", () => {
  assert.match(envExample, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.doesNotMatch(envExample, /^SUPABASE_SERVICE_ROLE_KEY=.+$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/i);
  assert.equal(existsSync(join(root, "lib", "supabase", "client.ts")), false);
  const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
  assert.doesNotMatch(proxy, /SERVICE_ROLE/i);
});

test("credenciais OAuth e estados nunca ficam acessíveis ao cliente", () => {
  assert.match(integrations, /alter table public\.integration_credentials enable row level security/i);
  assert.match(integrations, /alter table public\.oauth_states enable row level security/i);
  assert.match(integrations, /revoke all on public\.integration_credentials from anon, authenticated/i);
  assert.match(integrations, /revoke all on public\.oauth_states from anon, authenticated/i);
  assert.doesNotMatch(integrations, /create policy integration_credentials/i);
});

test("cotação pertence ao usuário e confirmação PagBank é exclusiva da service role", () => {
  assert.match(integrations, /shipping_quotes_own_read[\s\S]*customer_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(integrations, /revoke all on function public\.confirm_pagbank_payment[\s\S]*authenticated/i);
  assert.match(integrations, /grant execute on function public\.confirm_pagbank_payment[\s\S]*to service_role/i);
  assert.match(integrations, /revoke all on function public\.create_customer_order[\s\S]*from public, anon/i);
});

test("reservas de estoque são inacessíveis ao cliente e exclusivas da service role", () => {
  assert.match(pagBankHardening, /alter table public\.inventory_reservations enable row level security/i);
  assert.match(pagBankHardening, /revoke all on public\.inventory_reservations from public, anon, authenticated/i);
  assert.match(pagBankHardening, /reserve_order_stock[\s\S]*to service_role/i);
  assert.match(pagBankHardening, /release_order_stock_reservation[\s\S]*to service_role/i);
});

test("persistência local foi removida do runtime e o JSON de origem foi preservado", () => {
  const runtimeFiles = [
    join(root, "app"),
    join(root, "components"),
    join(root, "services"),
  ];
  for (const directory of runtimeFiles) {
    for (const file of sourceFiles(directory)) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /json-product-repository|data\/products\.local\.json/, file);
    }
  }
  assert.doesNotThrow(() => readFileSync(join(root, "data", "products.local.json"), "utf8"));
});
