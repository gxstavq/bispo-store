import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const expectedHost = "jpyqsaxyrbsdmfylayax.supabase.co";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Variáveis Supabase ausentes.");
if (new URL(url).host !== expectedHost) throw new Error("Teste recusado fora da homologação.");
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente para este teste.");
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const tag = `[TESTE ADMIN FINAL ${runId}]`;
const tracked = { userId: null, productIds: [], orderIds: [], categoryId: null, variantIds: [] };
const checks = [];

function pass(name, condition, details = "") {
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  checks.push(name);
}

function isRlsBlocked(response) {
  return response.error?.code === "42501"
    || (!response.error && Array.isArray(response.data) && response.data.length === 0);
}

async function dataOf(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.code ?? "unknown"} ${error.message}`);
  return data;
}

async function counts() {
  const tables = [
    "products", "product_images", "product_variants", "admin_users", "orders",
    "customers", "addresses", "payments", "inventory_reservations",
    "inventory_movements", "store_settings", "integration_credentials",
  ];
  const result = {};
  for (const table of tables) {
    const { count, error } = await service.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    result[table] = count;
  }
  const auth = await dataOf(service.auth.admin.listUsers({ page: 1, perPage: 1000 }), "count auth");
  result.authUsers = auth.users.length;
  return result;
}

async function createOrder(client, productId, size, color, suffix) {
  const email = `bispo-admin-final-${runId}@example.com`;
  const response = await client.rpc("create_customer_order", {
    customer_data: { full_name: `${tag} Cliente`, whatsapp: "5511999999999", email },
    address_data: {
      postal_code: "03870-100", street: "Avenida São Miguel", number: "5046",
      complement: "TESTE DESCARTÁVEL", district: "Ponte Rasa", city: "São Paulo",
      state: "SP", reference: tag,
    },
    cart_items: [{ product_id: productId, size, color, quantity: 1 }],
    requested_delivery_choice: "local_delivery_review",
    order_notes: `${tag} ${suffix}`,
    selected_shipping_quote_id: null,
    requested_idempotency_key: randomUUID(),
  });
  if (response.error) throw new Error(`create order ${suffix}: ${response.error.code} ${response.error.message}`);
  const number = response.data?.[0]?.order_number;
  const order = await dataOf(service.from("orders").select("id,order_number,status,payment_status,stock_deducted_at").eq("order_number", number).single(), `read order ${suffix}`);
  tracked.orderIds.push(order.id);
  return order;
}

async function cleanup() {
  const errors = [];
  try {
    if (tracked.orderIds.length) await dataOf(service.from("orders").delete().in("id", tracked.orderIds), "cleanup orders");
    if (tracked.userId) {
      const customers = await dataOf(service.from("customers").select("id").eq("user_id", tracked.userId), "read cleanup customers");
      const customerIds = customers.map((row) => row.id);
      if (customerIds.length) {
        await dataOf(service.from("addresses").delete().in("customer_id", customerIds), "cleanup addresses");
        await dataOf(service.from("customers").delete().in("id", customerIds), "cleanup customers");
      }
    }
    if (tracked.productIds.length) {
      await dataOf(service.from("inventory_movements").delete().in("product_id", tracked.productIds), "cleanup inventory movements");
      await dataOf(service.from("products").delete().in("id", tracked.productIds), "cleanup products");
    }
    if (tracked.categoryId) await dataOf(service.from("categories").delete().eq("id", tracked.categoryId), "cleanup category");
    if (tracked.productIds.length || tracked.orderIds.length) {
      await dataOf(service.from("audit_logs").delete().in("record_id", [...tracked.productIds, ...tracked.orderIds]), "cleanup audit logs");
    }
    if (tracked.userId) {
      await dataOf(service.from("audit_logs").delete().eq("actor_user_id", tracked.userId), "cleanup actor audit logs");
      await dataOf(service.from("admin_users").delete().eq("user_id", tracked.userId), "cleanup admin row");
      await dataOf(service.auth.admin.deleteUser(tracked.userId), "cleanup auth user");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (errors.length) throw new Error(errors.join(" | "));
}

const before = await counts();
let primaryError;
try {
  const email = `bispo-admin-final-${runId}@example.com`;
  const password = `Tmp!${randomBytes(24).toString("base64url")}`;
  const created = await dataOf(service.auth.admin.createUser({ email, password, email_confirm: true }), "create synthetic auth user");
  tracked.userId = created.user.id;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await dataOf(client.auth.signInWithPassword({ email, password }), "sign in synthetic user");

  const beforePromotion = await client.from("inventory_movements").select("id");
  pass("authenticated comum não lê movimentações", isRlsBlocked(beforePromotion));
  const anonRead = await anon.from("inventory_movements").select("id");
  pass("anon não lê movimentações", isRlsBlocked(anonRead));

  await dataOf(service.from("admin_users").insert({ user_id: tracked.userId, email, display_name: tag, active: true }), "promote synthetic admin");
  const coreCategory = await dataOf(service.from("categories").select("id,slug").eq("slug", "tenis").single(), "read core category");
  const category = await dataOf(client.from("categories").insert({ slug: `teste-bones-${runId}`, name: `${tag} Bonés`, description: tag, active: true, sort_order: 9998 }).select("id").single(), "create dynamic category");
  tracked.categoryId = category.id;
  pass("categoria dinâmica criada por administrador", Boolean(category.id));

  const productPayload = {
    category_slug: `teste-bones-${runId}`, name: `${tag} Produto variantes`, slug: `teste-admin-final-${runId}`,
    code: `TEST-ADMIN-${runId}`, description: `${tag} completo`, price: 149.9,
    promotional_price: "", weight_kg: 1.25, length_cm: 33, width_cm: 20,
    height_cm: 12, packaging_category: "caixa-tenis", shipping_enabled: true,
    featured: false, is_new: false, status: "active", needs_review: false, images_confirmed: true,
  };
  const productId = await dataOf(client.rpc("save_admin_product", {
    target_product_id: null, product_data: productPayload, images_data: [], variants_data: [
      { id: null, sku: `TEST-ADMIN-${runId}-A`, size: "39", color: "Off-white", stock: 5, active: true },
      { id: null, sku: `TEST-ADMIN-${runId}-B`, size: "40", color: "Preto e branco", stock: 7, active: true },
    ],
  }), "create product by RPC");
  tracked.productIds.push(productId);
  let variants = await dataOf(service.from("product_variants").select("id,size,color,stock,active").eq("product_id", productId).order("size"), "read variants");
  tracked.variantIds.push(...variants.map((row) => row.id));
  const [reservedVariant, adjustableVariant] = variants;

  const adjusted = await dataOf(client.rpc("adjust_product_variant_stock", {
    target_variant_id: adjustableVariant.id, adjustment_operation: "add", adjustment_quantity: 5,
    adjustment_reason: "Teste automatizado", adjustment_note: tag, request_idempotency_key: randomUUID(),
  }), "add stock");
  await dataOf(client.rpc("adjust_product_variant_stock", {
    target_variant_id: adjustableVariant.id, adjustment_operation: "remove", adjustment_quantity: 2,
    adjustment_reason: "Teste automatizado", adjustment_note: tag, request_idempotency_key: randomUUID(),
  }), "remove stock");
  await dataOf(client.rpc("adjust_product_variant_stock", {
    target_variant_id: adjustableVariant.id, adjustment_operation: "set", adjustment_quantity: adjustableVariant.stock,
    adjustment_reason: "Restaurar teste", adjustment_note: tag, request_idempotency_key: randomUUID(),
  }), "restore stock");
  pass("ajuste de estoque auditável e restaurado", adjusted.new_stock === adjustableVariant.stock + 5);

  const dependencyOrder = await createOrder(client, productId, reservedVariant.size, reservedVariant.color, "variant-dependency");
  await dataOf(client.rpc("save_admin_product", {
    target_product_id: productId, product_data: productPayload, images_data: [], variants_data: [
      { id: adjustableVariant.id, sku: `TEST-ADMIN-${runId}-B`, size: adjustableVariant.size, color: adjustableVariant.color, stock: adjustableVariant.stock, active: true },
    ],
  }), "save product omitting reserved variant");
  const preserved = await dataOf(service.from("product_variants").select("id,stock,active").eq("id", reservedVariant.id).single(), "read preserved variant");
  pass("variante referenciada preserva UUID", preserved.id === reservedVariant.id);
  pass("variante referenciada removida fica inativa", preserved.active === false);
  pass("reserva válida não é apagada", (await dataOf(service.from("inventory_reservations").select("id").eq("order_id", dependencyOrder.id), "read dependency reservation")).length === 1);

  const archive = await dataOf(client.rpc("delete_or_archive_admin_product", { target_product_id: productId, delete_permanently: true }), "safe product delete");
  pass("produto com histórico é arquivado", archive.archived === true && archive.had_dependencies === true);
  const archivedVariant = await dataOf(service.from("product_variants").select("stock").eq("id", adjustableVariant.id).single(), "read archived stock");
  pass("arquivamento preserva estoque", archivedVariant.stock === adjustableVariant.stock);

  await dataOf(service.from("orders").delete().eq("id", dependencyOrder.id), "remove dependency order");
  tracked.orderIds = tracked.orderIds.filter((id) => id !== dependencyOrder.id);
  await dataOf(client.rpc("save_admin_product", {
    target_product_id: productId, product_data: { ...productPayload, status: "active" }, images_data: [], variants_data: [
      { id: reservedVariant.id, sku: `TEST-ADMIN-${runId}-A`, size: reservedVariant.size, color: reservedVariant.color, stock: reservedVariant.stock, active: true },
      { id: adjustableVariant.id, sku: `TEST-ADMIN-${runId}-B`, size: adjustableVariant.size, color: adjustableVariant.color, stock: adjustableVariant.stock, active: true },
    ],
  }), "restore product for order tests");

  const paymentOrder = await createOrder(client, productId, reservedVariant.size, reservedVariant.color, "manual-payment");
  await dataOf(service.from("orders").update({ status: "awaiting_payment", payment_status: "awaiting_payment", shipping_amount: 0, shipping_status: "free_approved" }).eq("id", paymentOrder.id), "prepare manual payment order");
  const stockBeforePayment = (await dataOf(service.from("product_variants").select("stock").eq("id", reservedVariant.id).single(), "stock before payment")).stock;
  const confirmation = await dataOf(client.rpc("confirm_manual_order_payment", { target_order_number: paymentOrder.order_number, target_actor_user_id: tracked.userId, confirmation_note: tag }), "confirm manual payment");
  const stockAfterPayment = (await dataOf(service.from("product_variants").select("stock").eq("id", reservedVariant.id).single(), "stock after payment")).stock;
  const duplicate = await dataOf(client.rpc("confirm_manual_order_payment", { target_order_number: paymentOrder.order_number, target_actor_user_id: tracked.userId, confirmation_note: tag }), "repeat manual payment");
  const stockAfterDuplicate = (await dataOf(service.from("product_variants").select("stock").eq("id", reservedVariant.id).single(), "stock after duplicate")).stock;
  pass("pagamento manual baixa estoque uma vez", confirmation.stock_deducted === true && stockAfterPayment === stockBeforePayment - 1 && stockAfterDuplicate === stockAfterPayment);
  pass("pagamento manual repetido é idempotente", duplicate.duplicate === true);

  const cancelOrder = await createOrder(client, productId, adjustableVariant.size, adjustableVariant.color, "manual-cancel");
  await dataOf(service.from("orders").update({ status: "awaiting_payment", payment_status: "awaiting_payment", shipping_amount: 0, shipping_status: "free_approved" }).eq("id", cancelOrder.id), "prepare cancel order");
  await dataOf(client.rpc("cancel_manual_order", { target_order_number: cancelOrder.order_number, target_actor_user_id: tracked.userId, cancellation_note: tag }), "cancel manual order");
  const released = await dataOf(service.from("inventory_reservations").select("status").eq("order_id", cancelOrder.id), "read released reservation");
  pass("cancelamento libera reserva", released.length === 1 && released[0].status === "released");

  const categoryResult = await dataOf(client.rpc("delete_or_archive_category", { target_category_id: category.id, replacement_category_id: coreCategory.id }), "reassign and delete category");
  tracked.categoryId = null;
  pass("categoria com produto é reatribuída antes da exclusão", categoryResult.deleted === true && categoryResult.reassigned === 1);
  const reassigned = await dataOf(service.from("products").select("category_id").eq("id", productId).single(), "read reassigned product");
  pass("produto não fica órfão", reassigned.category_id === coreCategory.id);
} catch (error) {
  primaryError = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else primaryError = new Error(`${primaryError.message} | cleanup: ${cleanupError.message}`);
  }
}

if (primaryError) throw primaryError;
const after = await counts();
for (const [key, value] of Object.entries(before)) {
  pass(`contagem preservada: ${key}`, after[key] === value, `${value} -> ${after[key]}`);
}
console.log(JSON.stringify({ runId, checks: checks.length, before, after, result: "approved" }, null, 2));
