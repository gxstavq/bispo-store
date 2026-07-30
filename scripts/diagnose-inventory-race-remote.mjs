import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_PROJECT_HOST = "jpyqsaxyrbsdmfylayax.supabase.co";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("As variáveis do Supabase são obrigatórias.");
}
if (new URL(supabaseUrl).host !== EXPECTED_PROJECT_HOST) {
  throw new Error("Diagnóstico recusado fora da homologação autorizada.");
}
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente para este diagnóstico.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const trace = {
  runId,
  projectHost: EXPECTED_PROJECT_HOST,
  startedAt: new Date().toISOString(),
  idempotencyKeys: [randomUUID(), randomUUID()],
  calls: [],
  stateBeforeRace: null,
  stateAfterRace: null,
  cleanup: null,
};
const created = {
  users: [],
  customers: [],
  addresses: [],
  orders: [],
  products: [],
  variants: [],
};

async function requireData(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.code ?? "unknown"} ${error.message}`);
  return data;
}

async function counts() {
  const names = [
    "products",
    "product_images",
    "product_variants",
    "admin_users",
    "orders",
    "customers",
    "addresses",
    "payments",
    "store_settings",
    "integration_credentials",
    "inventory_reservations",
  ];
  const result = {};
  for (const name of names) {
    const { count, error } = await service.from(name).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${name}: ${error.message}`);
    result[name] = count;
  }
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`count auth users: ${error.message}`);
  result.authUsers = data.users.length;
  return result;
}

async function createUser(index) {
  const email = `bispo-race-${runId}-${index}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const auth = await requireData(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
    `create user ${index}`,
  );
  created.users.push(auth.user.id);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await requireData(client.auth.signInWithPassword({ email, password }), `sign in user ${index}`);
  return client;
}

async function createOrder(client, index, productId, idempotencyKey) {
  const rows = await requireData(
    client.rpc("create_customer_order", {
      customer_data: {
        full_name: `[TESTE CONCORRÊNCIA] Cliente ${index}`,
        whatsapp: "5511999999999",
        email: `bispo-race-${runId}-${index}@example.com`,
      },
      address_data: {
        postal_code: "03870-100",
        street: "Avenida São Miguel",
        number: "5046",
        complement: "TESTE DESCARTÁVEL",
        district: "Ponte Rasa",
        city: "São Paulo",
        state: "SP",
        reference: `TESTE CONCORRÊNCIA ${runId}`,
      },
      cart_items: [{ product_id: productId, size: "40", color: "Preto", quantity: 1 }],
      requested_delivery_choice: "local_delivery_review",
      order_notes: `[TESTE CONCORRÊNCIA ${runId}]`,
      selected_shipping_quote_id: null,
      requested_idempotency_key: idempotencyKey,
    }),
    `create order ${index}`,
  );
  const orderNumber = rows[0].order_number;
  const order = await requireData(
    service
      .from("orders")
      .select("id,order_number,customer_id,address_id,idempotency_key")
      .eq("order_number", orderNumber)
      .single(),
    `read order ${index}`,
  );
  created.orders.push(order.id);
  created.customers.push(order.customer_id);
  created.addresses.push(order.address_id);
  return order;
}

async function reserveWithTrace(label, orderId) {
  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  const response = await service.rpc("reserve_order_stock", {
    target_order_id: orderId,
    reservation_expires_at: new Date(Date.now() + 120 * 60_000).toISOString(),
  });
  const finishedMonotonicMs = performance.now();
  const result = {
    label,
    orderId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Number((finishedMonotonicMs - startedMonotonicMs).toFixed(3)),
    ok: !response.error,
    rows: response.data ?? null,
    error: response.error
      ? {
          sqlstate: response.error.code ?? null,
          message: response.error.message,
          details: response.error.details ?? null,
          hint: response.error.hint ?? null,
        }
      : null,
  };
  trace.calls.push(result);
  return result;
}

async function syntheticState(variantId) {
  const variant = await requireData(
    service.from("product_variants").select("id,stock").eq("id", variantId).single(),
    "read synthetic stock",
  );
  const reservations = await requireData(
    service
      .from("inventory_reservations")
      .select("id,order_id,variant_id,quantity,status,expires_at,created_at,updated_at")
      .eq("variant_id", variantId)
      .order("created_at"),
    "read synthetic reservations",
  );
  const orders = await requireData(
    service
      .from("orders")
      .select("id,order_number,idempotency_key,customer_id,address_id,status,payment_status")
      .in("id", created.orders),
    "read synthetic orders",
  );
  const payments = await requireData(
    service.from("payments").select("id,order_id,status").in("order_id", created.orders),
    "read synthetic payments",
  );
  return {
    stock: variant.stock,
    activeReservationQuantity: reservations
      .filter((row) => row.status === "active")
      .reduce((sum, row) => sum + row.quantity, 0),
    reservations,
    orders,
    payments,
  };
}

async function cleanup() {
  const errors = [];
  async function remove(label, promise) {
    const { error } = await promise;
    if (error) errors.push({ label, code: error.code ?? null, message: error.message });
  }
  if (created.orders.length) {
    await remove(
      "order_status_history",
      service.from("order_status_history").delete().in("order_id", created.orders),
    );
    await remove(
      "shipping_decisions",
      service.from("shipping_decisions").delete().in("order_id", created.orders),
    );
    await remove(
      "shipping_quotes",
      service.from("shipping_quotes").delete().in("order_id", created.orders),
    );
    await remove("payments", service.from("payments").delete().in("order_id", created.orders));
    await remove(
      "inventory_reservations",
      service.from("inventory_reservations").delete().in("order_id", created.orders),
    );
    await remove("orders", service.from("orders").delete().in("id", created.orders));
  }
  if (created.addresses.length) {
    await remove("addresses", service.from("addresses").delete().in("id", created.addresses));
  }
  if (created.customers.length) {
    await remove("customers", service.from("customers").delete().in("id", created.customers));
  }
  if (created.products.length) {
    await remove("products", service.from("products").delete().in("id", created.products));
  }
  const recordIds = [...created.orders, ...created.products, ...created.variants];
  if (recordIds.length) {
    await remove("audit_logs", service.from("audit_logs").delete().in("record_id", recordIds));
  }
  for (const userId of created.users) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) errors.push({ label: "auth_user", code: error.code ?? null, message: error.message });
  }
  return errors;
}

const countsBefore = await counts();
let diagnosticError = null;
try {
  const category = await requireData(
    service.from("categories").select("id").eq("slug", "tenis").single(),
    "read category",
  );
  const product = await requireData(
    service
      .from("products")
      .insert({
        category_id: category.id,
        name: `[TESTE CONCORRÊNCIA] ${runId}`,
        slug: `teste-corrida-${runId}`,
        code: `TEST-RACE-${runId}`,
        description: "Produto sintético descartável.",
        price: 100,
        weight_kg: 1.25,
        length_cm: 33,
        width_cm: 20,
        height_cm: 12,
        packaging_category: "caixa-tenis",
        shipping_enabled: true,
        status: "active",
        needs_review: false,
      })
      .select("id")
      .single(),
    "create synthetic product",
  );
  created.products.push(product.id);
  const variant = await requireData(
    service
      .from("product_variants")
      .insert({
        product_id: product.id,
        sku: `TEST-RACE-${runId}-40`,
        size: "40",
        color: "Preto",
        stock: 1,
        active: true,
      })
      .select("id,stock")
      .single(),
    "create synthetic variant",
  );
  created.variants.push(variant.id);

  const [clientA, clientB] = await Promise.all([createUser(1), createUser(2)]);
  const [orderA, orderB] = await Promise.all([
    createOrder(clientA, 1, product.id, trace.idempotencyKeys[0]),
    createOrder(clientB, 2, product.id, trace.idempotencyKeys[1]),
  ]);
  trace.orders = [orderA, orderB];
  trace.stateBeforeRace = await syntheticState(variant.id);
  trace.calls = await Promise.all([
    reserveWithTrace("A", orderA.id),
    reserveWithTrace("B", orderB.id),
  ]);
  trace.stateAfterRace = await syntheticState(variant.id);
} catch (error) {
  diagnosticError = {
    name: error.name,
    message: error.message,
    stack: error.stack?.split("\n").slice(0, 4),
  };
} finally {
  trace.cleanupErrors = await cleanup();
  trace.countsBefore = countsBefore;
  trace.countsAfter = await counts();
  trace.finishedAt = new Date().toISOString();
  trace.diagnosticError = diagnosticError;
}

console.log(JSON.stringify(trace, null, 2));
if (diagnosticError || trace.cleanupErrors.length) process.exitCode = 1;
