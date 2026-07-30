import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const anonymous = createClient(url, anonKey, clientOptions);
const server = createClient(url, serviceRoleKey, clientOptions);

const { data: publicProducts, error: publicProductsError } = await anonymous
  .from("products")
  .select("id, price, status")
  .limit(5);
assert.ifError(publicProductsError);
assert.ok(publicProducts.length > 0, "o catálogo público deveria conter produtos ativos");
assert.ok(publicProducts.every((product) => product.status === "active"));

const protectedTables = [
  "admin_users", "store_settings", "audit_logs", "customers", "addresses", "orders",
  "order_items", "shipping_quotes", "shipping_decisions", "payments",
  "payment_events", "shipment_labels", "order_status_history", "integration_errors",
  "integration_credentials", "oauth_states", "inventory_reservations",
];
for (const table of protectedTables) {
  const { data, error } = await anonymous.from(table).select("*").limit(1);
  assert.ok(error || data?.length === 0, `visitante anônimo não pode ler ${table}`);
}

const target = publicProducts[0];
const attemptedPrice = Number(target.price) + 12345;
const { data: writeResult, error: writeError } = await anonymous
  .from("products")
  .update({ price: attemptedPrice })
  .eq("id", target.id)
  .select("id");
assert.ok(writeError || writeResult.length === 0, "visitante anônimo não pode alterar preços");

const { data: unchangedProduct, error: unchangedError } = await server
  .from("products")
  .select("price")
  .eq("id", target.id)
  .single();
assert.ifError(unchangedError);
assert.equal(Number(unchangedProduct.price), Number(target.price), "o preço não pode ser adulterado");

const testEmail = `security-${randomUUID()}@example.invalid`;
const testPassword = randomBytes(24).toString("base64url");
let testUserId;
try {
  const { data: created, error: createError } = await server.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  assert.ifError(createError);
  assert.ok(created.user);
  testUserId = created.user.id;

  const common = createClient(url, anonKey, clientOptions);
  const { error: signInError } = await common.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  assert.ifError(signInError);

  for (const table of protectedTables) {
    const { data, error } = await common.from(table).select("*").limit(1);
    assert.ok(error || data?.length === 0, `usuário comum não pode ler ${table}`);
  }

  const { data: anyOrder, error: anyOrderError } = await server
    .from("orders")
    .select("order_number")
    .limit(1)
    .maybeSingle();
  assert.ifError(anyOrderError);
  if (anyOrder) {
    const { data: foreignOrder, error: foreignOrderError } = await common
      .from("orders")
      .select("id")
      .eq("order_number", anyOrder.order_number);
    assert.ifError(foreignOrderError);
    assert.deepEqual(foreignOrder, [], "usuário comum não acessa pedido de outro cliente");
  }

  const { data: commonWrite, error: commonWriteError } = await common
    .from("products")
    .update({ price: attemptedPrice })
    .eq("id", target.id)
    .select("id");
  assert.ok(commonWriteError || commonWrite.length === 0, "usuário comum não altera preços");

  const { error: confirmError } = await common.rpc("confirm_pagbank_payment", {
    target_checkout_id: "invalid",
    confirmed_status: "paid",
    confirmed_method: "PIX",
    provider_raw_status: "PAID",
  });
  assert.ok(confirmError, "usuário comum não confirma pagamento");
} finally {
  if (testUserId) await server.auth.admin.deleteUser(testUserId);
}

const counts = {};
for (const table of ["products", "product_images", "product_variants", "audit_logs"]) {
  const { count, error } = await server.from(table).select("id", { count: "exact", head: true });
  assert.ifError(error);
  counts[table] = count ?? 0;
}
assert.equal(counts.products, 110);
assert.equal(counts.product_images, 188);
assert.equal(counts.product_variants, 644);
assert.ok(counts.audit_logs >= 754, "a auditoria deve conter inserções de produtos e variantes");

console.log(JSON.stringify({
  result: "ok",
  publicCatalogReadable: true,
  protectedTablesHidden: protectedTables.length,
  anonymousPriceWriteBlocked: true,
  commonUserIsolationVerified: true,
  counts,
}, null, 2));
