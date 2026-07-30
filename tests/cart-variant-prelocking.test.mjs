import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "20260730010000_atomic_cart_variant_prelocking.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  join(
    root,
    "supabase",
    "rollback",
    "20260730010000_atomic_cart_variant_prelocking.rollback.sql",
  ),
  "utf8",
);
const productRepository = readFileSync(
  join(root, "repositories", "supabase-product-repository.ts"),
  "utf8",
);
const orderRoute = readFileSync(join(root, "app", "api", "orders", "route.ts"), "utf8");

test("migration bloqueia variantes agregadas antes de inserir o pedido", () => {
  const lockPosition = migration.indexOf("perform private.lock_and_validate_cart_inventory(cart_items)");
  const createPosition = migration.indexOf(
    "from private.create_customer_order_unreserved_idempotent",
    lockPosition,
  );
  assert.ok(lockPosition >= 0);
  assert.ok(createPosition > lockPosition);
  assert.match(migration, /sum\(coalesce\(raw_items\.quantity, '1'\)::integer\)::integer/);
  assert.match(migration, /group by[\s\S]*raw_items\.product_id::uuid[\s\S]*btrim\(raw_items\.size\)[\s\S]*btrim\(raw_items\.color\)/);
  assert.match(migration, /order by variants\.id\s+for update of variants/);
  assert.match(migration, /locked_groups <> requested_groups/);
  assert.match(migration, /requested_item\.stock - already_reserved < requested_item\.quantity/);
});

test("as duas assinaturas públicas continuam disponíveis e atômicas", () => {
  assert.match(
    migration,
    /create function public\.create_customer_order\([\s\S]*requested_idempotency_key text/,
  );
  assert.match(
    migration,
    /create function public\.create_customer_order\([\s\S]*order_notes text default null/,
  );
  assert.equal(
    (migration.match(/perform private\.lock_and_validate_cart_inventory\(cart_items\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (migration.match(/from public\.reserve_order_stock\(/g) ?? []).length,
    2,
  );
  assert.match(migration, /set lock_timeout = '5s'/);
  assert.match(migration, /set statement_timeout = '15s'/);
});

test("idempotência é serializada antes dos row locks e preserva payload existente", () => {
  const advisoryPosition = migration.indexOf("perform pg_advisory_xact_lock");
  const inventoryPosition = migration.indexOf(
    "perform private.lock_and_validate_cart_inventory(cart_items)",
    advisoryPosition,
  );
  assert.ok(advisoryPosition >= 0);
  assert.ok(inventoryPosition > advisoryPosition);
  assert.match(migration, /existing_order\.idempotency_fingerprint is distinct from request_fingerprint/);
  assert.match(migration, /idempotency_key_reused_with_different_payload/);
  assert.match(migration, /return query select existing_order\.order_number/);
});

test("atualização administrativa usa RPC transacional com locks determinísticos", () => {
  assert.match(migration, /create function public\.replace_product_variants/);
  assert.match(
    migration,
    /where variants\.product_id = target_product_id\s+order by variants\.id\s+for update/,
  );
  assert.match(migration, /on conflict \(product_id, size, color\) do update/);
  assert.match(migration, /not private\.is_admin\(auth\.uid\(\)\)/);
  assert.match(productRepository, /\.rpc\("replace_product_variants"/);
  assert.doesNotMatch(
    productRepository,
    /from\("product_variants"\)\.delete\(\)\.eq\("product_id"/,
  );
});

test("migration e rollback são transacionais e não destroem dados", () => {
  assert.equal((migration.match(/\bbegin;/gi) ?? []).length, 1);
  assert.equal((migration.match(/\bcommit;/gi) ?? []).length, 1);
  assert.equal((rollback.match(/\bbegin;/gi) ?? []).length, 1);
  assert.equal((rollback.match(/\bcommit;/gi) ?? []).length, 1);
  assert.doesNotMatch(
    migration,
    /drop table|drop column|truncate\s|delete from public\.(orders|customers|addresses|order_items|inventory_reservations)/i,
  );
  assert.doesNotMatch(
    rollback,
    /drop table|drop column|truncate\s|delete from public\.(orders|customers|addresses|order_items|inventory_reservations)/i,
  );
  assert.doesNotMatch(
    migration,
    /integration_credentials|oauth_states|access_token|refresh_token|client_secret/i,
  );
  assert.match(rollback, /create_customer_order_pre_20260730010000_idempotent/);
  assert.match(rollback, /create_customer_order_pre_20260730010000_legacy/);
});

test("erros de estoque e timeout continuam convertidos em HTTP 409", () => {
  assert.match(orderRoute, /error\.code === "55P03"/);
  assert.match(orderRoute, /insufficient_available_stock/);
  assert.match(orderRoute, /variant_unavailable/);
  assert.match(orderRoute, /status: 409/);
});
