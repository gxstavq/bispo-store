import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  formatAdminDecimal,
  parseAdminDecimal,
  uniqueAdminTokens,
} from "../lib/admin-product-editor.ts";

const root = process.cwd();
const source = (file) => readFileSync(join(root, ...file.split("/")), "utf8");
const migration = source("supabase/migrations/20260731210000_admin_final_review.sql");
const rollback = source("supabase/rollback/20260731210000_admin_final_review.rollback.sql");
const sessionGrantMigration = source("supabase/migrations/20260731213000_admin_manual_order_session_grants.sql");
const inventoryHistoryMigration = source("supabase/migrations/20260801003000_archive_products_with_inventory_history.sql");
const inventoryHistoryRollback = source("supabase/rollback/20260801003000_archive_products_with_inventory_history.rollback.sql");

test("preços administrativos aceitam ponto, vírgula e vazio sem forçar zero", () => {
  assert.equal(parseAdminDecimal(""), null);
  assert.equal(parseAdminDecimal("149,90"), 149.9);
  assert.equal(parseAdminDecimal("149.90"), 149.9);
  assert.equal(parseAdminDecimal("1.249,90"), 1249.9);
  assert.equal(parseAdminDecimal("1,249.90"), 1249.9);
  assert.ok(Number.isNaN(parseAdminDecimal("-1")));
  assert.ok(Number.isNaN(parseAdminDecimal("12.345")));
  assert.equal(formatAdminDecimal(149.9), "149,90");
  assert.equal(formatAdminDecimal(undefined), "");
});

test("chips removem espaços e duplicatas preservando a ordem", () => {
  assert.deepEqual(
    uniqueAdminTokens([" 38 ", "Off-white", "38", " off-white ", "Preto e branco"]),
    ["38", "Off-white", "Preto e branco"],
  );
});

test("salvamento do produto preserva UUIDs e mantém variante referenciada inativa", () => {
  assert.match(migration, /update public\.product_variants as variants[\s\S]*variants\.id = incoming\.id/);
  assert.match(migration, /where incoming\.id is null[\s\S]*on conflict \(product_id, size, color\)/);
  assert.match(migration, /if has_dependency then[\s\S]*set active = false/);
  assert.match(migration, /case when has_active_reservation then variants\.stock else 0 end/);
  assert.doesNotMatch(migration, /delete from public\.inventory_reservations/);
});

test("migration administrativa é transacional, protegida e reversível", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.match(migration, /alter table public\.inventory_movements enable row level security/);
  assert.match(migration, /revoke all on public\.inventory_movements from public, anon, authenticated/);
  assert.match(rollback, /rollback_blocked_dynamic_categories_exist/);
  assert.match(rollback, /rollback_blocked_inventory_movements_exist/);
  assert.doesNotMatch(migration, /truncate\s|delete from public\.(orders|customers|addresses|payments)/i);
});

test("estoque administrativo possui lock, idempotência e auditoria", () => {
  assert.match(migration, /create or replace function public\.adjust_product_variant_stock/);
  assert.match(migration, /where variants\.id = target_variant_id\s+for update/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /if calculated_stock < 0/);
  assert.match(migration, /admin_user_id, idempotency_key/);
});

test("categorias e banner são dinâmicos sem remover noindex", () => {
  const dynamicCategory = source("app/categoria/[slug]/page.tsx");
  const sitemap = source("app/sitemap.ts");
  const layout = source("app/layout.tsx");
  assert.match(dynamicCategory, /fetchPublicCategories/);
  assert.match(sitemap, /fetchPublicCategories/);
  assert.match(migration, /add column if not exists home_banner jsonb/);
  assert.match(layout, /index: false/);
});

test("banner padrão pode ser restaurado depois da primeira personalização", () => {
  const repository = source("repositories/home-banner-repository.ts");
  assert.match(repository, /const DEFAULT_HOME_BANNER/);
  assert.match(repository, /previous_home_banner: parse\(current\.home_banner\) \?\? DEFAULT_HOME_BANNER/);
  assert.match(repository, /parse\(data\.previous_home_banner\)[\s\S]*current \? DEFAULT_HOME_BANNER : null/);
});

test("produto com movimentação de estoque é arquivado em vez de sofrer exclusão inválida", () => {
  assert.match(inventoryHistoryMigration, /^begin;/m);
  assert.match(inventoryHistoryMigration, /from public\.inventory_movements as movements[\s\S]*movements\.product_id = target_product_id/);
  assert.match(inventoryHistoryMigration, /if not delete_permanently or has_history then[\s\S]*status = 'archived'/);
  assert.doesNotMatch(inventoryHistoryMigration, /delete from public\.inventory_movements/);
  assert.match(inventoryHistoryRollback, /create or replace function public\.delete_or_archive_admin_product/);
  assert.match(inventoryHistoryRollback, /^begin;[\s\S]*commit;\s*$/m);
});

test("Instagram oficial não usa link falso", () => {
  const footer = source("components/footer.tsx");
  assert.match(footer, /https:\/\/www\.instagram\.com\/bispostorebr_/);
  assert.match(footer, /target="_blank"/);
  assert.match(footer, /noopener noreferrer/);
  assert.doesNotMatch(footer, /href="#"/);
});

test("pedidos manuais são confirmados e cancelados por RPCs atômicas", () => {
  assert.match(migration, /create or replace function public\.confirm_manual_order_payment/);
  assert.match(migration, /create or replace function public\.cancel_manual_order/);
  assert.match(migration, /selected_order\.payment_status = 'paid'/);
  assert.match(migration, /on conflict \(provider, provider_event_id\)/);
  assert.match(migration, /paid_order_cannot_be_cancelled/);
  const paymentLock = migration.indexOf("where payments.checkout_id = checkout_identifier");
  const orderLock = migration.indexOf("where orders.id = selected_order_id\n  for update", paymentLock);
  assert.ok(paymentLock >= 0 && orderLock > paymentLock, "pagamento deve ser bloqueado antes do pedido");
  assert.match(migration, /if confirmation_result\.stock_error is not null[\s\S]*message = 'insufficient_stock'/);
  assert.match(sessionGrantMigration, /grant execute on function public\.confirm_manual_order_payment[\s\S]*to authenticated/);
  assert.match(sessionGrantMigration, /grant execute on function public\.cancel_manual_order[\s\S]*to authenticated/);
});
