import { createClient } from "@supabase/supabase-js";

const EXPECTED_PROJECT_HOST = "jpyqsaxyrbsdmfylayax.supabase.co";
const runId = process.argv[2];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!runId || !/^\d{13}-[0-9a-f]{6}$/.test(runId)) {
  throw new Error("Informe somente o runId sintético válido.");
}
if (!supabaseUrl || !serviceRoleKey || new URL(supabaseUrl).host !== EXPECTED_PROJECT_HOST) {
  throw new Error("Limpeza recusada fora da homologação autorizada.");
}
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("A limpeza exige autorização explícita para a homologação.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const errors = [];

async function rows(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function remove(label, table, filter, values) {
  for (const value of values) {
    const { error } = await filter(service.from(table).delete(), value);
    if (error) errors.push(`${label}: ${error.code ?? "unknown"} ${error.message}`);
  }
}

const products = await rows(
  service
    .from("products")
    .select("id")
    .or(`code.like.TEST-ATOMIC-${runId}-%,code.eq.TEST-PRELOCK-${runId}`),
  "read products",
);
const productIds = products.map((row) => row.id);
const variants = productIds.length
  ? await rows(
      service.from("product_variants").select("id").in("product_id", productIds),
      "read variants",
    )
  : [];
const variantIds = variants.map((row) => row.id);

const { data: authData, error: authError } = await service.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (authError) throw new Error(`read auth users: ${authError.message}`);
const userIds = authData.users
  .filter((user) =>
    user.email?.startsWith(`bispo-atomic-${runId}-`)
    || user.email?.startsWith(`bispo-prelock-${runId}-`))
  .map((user) => user.id);
const customers = userIds.length
  ? await rows(service.from("customers").select("id").in("user_id", userIds), "read customers")
  : [];
const customerIds = customers.map((row) => row.id);
const ordersByCustomer = customerIds.length
  ? await rows(service.from("orders").select("id,address_id").in("customer_id", customerIds), "read orders")
  : [];
const orderItems = productIds.length
  ? await rows(service.from("order_items").select("order_id").in("product_id", productIds), "read order items")
  : [];
const orderIds = [...new Set([
  ...ordersByCustomer.map((row) => row.id),
  ...orderItems.map((row) => row.order_id),
])];
const addressIds = [...new Set(ordersByCustomer.map((row) => row.address_id))];

await remove("order history", "order_status_history", (query, id) => query.eq("order_id", id), orderIds);
await remove("shipping decisions", "shipping_decisions", (query, id) => query.eq("order_id", id), orderIds);
await remove("shipping quotes", "shipping_quotes", (query, id) => query.eq("order_id", id), orderIds);
await remove("payments", "payments", (query, id) => query.eq("order_id", id), orderIds);
await remove("reservations", "inventory_reservations", (query, id) => query.eq("order_id", id), orderIds);
await remove("order items", "order_items", (query, id) => query.eq("order_id", id), orderIds);
await remove("orders", "orders", (query, id) => query.eq("id", id), orderIds);
await remove("addresses", "addresses", (query, id) => query.eq("id", id), addressIds);
await remove("customers", "customers", (query, id) => query.eq("id", id), customerIds);
await remove("products", "products", (query, id) => query.eq("id", id), productIds);

const auditIds = [...orderIds, ...productIds, ...variantIds];
await remove("audit logs", "audit_logs", (query, id) => query.eq("record_id", id), auditIds);

for (const userId of userIds) {
  let deleted = false;
  for (let attempt = 0; attempt < 3 && !deleted; attempt += 1) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (!error) {
      deleted = true;
    } else if (attempt === 2) {
      errors.push(`auth user: ${error.code ?? "unknown"} ${error.message ?? "unknown"}`);
    }
  }
}

console.log(JSON.stringify({
  runId,
  removed: {
    products: productIds.length,
    variants: variantIds.length,
    users: userIds.length,
    customers: customerIds.length,
    addresses: addressIds.length,
    orders: orderIds.length,
  },
  errors,
}, null, 2));
if (errors.length) process.exitCode = 1;
