import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const EXPECTED_PROJECT_HOST = "jpyqsaxyrbsdmfylayax.supabase.co";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("As variáveis do Supabase são obrigatórias.");
}
if (new URL(supabaseUrl).host !== EXPECTED_PROJECT_HOST) {
  throw new Error("Teste recusado fora da homologação autorizada.");
}
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente neste teste.");
}

async function timeoutFetch(input, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timeout);
  }
}

function client(key) {
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timeoutFetch },
  });
}

const service = client(serviceRoleKey);
const anon = client(anonKey);
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const tag = `[TESTE PRELOCK ${runId}]`;
const onlyLockTimeout = process.env.ONLY_LOCK_TIMEOUT === "true";
const checks = [];
const metrics = {
  stockOneHundredRuns: { iterations: 100, winners: 0, rejected: 0 },
  stockTenRace: { winners: 0, rejected: 0 },
  idempotency: { responses: 0, distinctOrders: 0 },
  lockTimeout: { holderDurationMs: null },
};
const created = {
  userIds: [],
  productIds: [],
  variantIds: [],
  orderIds: [],
  addressIds: [],
  paymentIds: [],
};

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  checks.push(name);
}

async function requireData(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.code ?? "unknown"} ${error.message}`);
  return data;
}

async function counts() {
  const tables = [
    "admin_users",
    "categories",
    "products",
    "product_images",
    "product_variants",
    "customers",
    "addresses",
    "orders",
    "order_items",
    "shipping_quotes",
    "shipping_decisions",
    "payments",
    "payment_events",
    "inventory_reservations",
    "shipment_labels",
    "order_status_history",
    "store_settings",
    "audit_logs",
    "integration_errors",
    "integration_credentials",
    "oauth_states",
  ];
  const result = {};
  for (const table of tables) {
    const { count, error } = await service
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.code ?? "unknown"} ${error.message}`);
    result[table] = count;
  }
  const authResult = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authResult.error) throw new Error(`count auth users: ${authResult.error.message}`);
  result.authUsers = authResult.data.users.length;
  return result;
}

function parseCliJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Supabase CLI não retornou JSON.");
  return JSON.parse(stdout.slice(start, end + 1));
}

async function supabaseCli(args) {
  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  const { stdout } = await execFileAsync(
    process.execPath,
    [npxCli, "--yes", "supabase@latest", ...args, "--output-format", "json"],
    {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return parseCliJson(stdout);
}

async function assertNoDatabaseWaits(phase) {
  const blocking = await supabaseCli(["inspect", "db", "blocking", "--linked"]);
  pass(`${phase}: no blocked sessions`, blocking.rows?.length === 0);
}

async function createUser(index) {
  const email = `bispo-prelock-${runId}-${index}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const authData = await requireData(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
    `create user ${index}`,
  );
  created.userIds.push(authData.user.id);
  const authenticated = client(anonKey);
  await requireData(
    authenticated.auth.signInWithPassword({ email, password }),
    `sign in user ${index}`,
  );
  return { client: authenticated, email, index, userId: authData.user.id };
}

async function createCatalog(categoryId) {
  const product = await requireData(
    service
      .from("products")
      .insert({
        category_id: categoryId,
        name: `${tag} Produto`,
        slug: `teste-prelock-${runId}`,
        code: `TEST-PRELOCK-${runId}`,
        description: `${tag} registro descartável`,
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
  created.productIds.push(product.id);
  const definitions = [
    ["RACE100", 1],
    ["STOCK10", 10],
    ["INVERSE-A", 1],
    ["INVERSE-B", 1],
    ["ATOMIC-A", 1],
    ["ATOMIC-B", 0],
    ["IDEMPOTENCY", 1],
    ["PAY-CREATE", 1],
    ["CANCEL-CREATE", 1],
    ["EXPIRE-CREATE", 1],
    ["LOCK-TIMEOUT", 1],
    ["LEGACY", 1],
    ["ADMIN", 1],
  ];
  const variants = await requireData(
    service
      .from("product_variants")
      .insert(definitions.map(([size, stock], index) => ({
        product_id: product.id,
        sku: `TEST-PRELOCK-${runId}-${index}`,
        size,
        color: "Preto",
        stock,
        active: true,
      })))
      .select("id,sku,size,color,stock,active"),
    "create synthetic variants",
  );
  created.variantIds.push(...variants.map((variant) => variant.id));
  return {
    productId: product.id,
    variants: Object.fromEntries(variants.map((variant) => [variant.size, variant])),
  };
}

const addressData = {
  postal_code: "03870-100",
  street: "Avenida São Miguel",
  number: "5046",
  complement: "TESTE DESCARTÁVEL",
  district: "Ponte Rasa",
  city: "São Paulo",
  state: "SP",
  reference: "Teste automatizado descartável",
};

function customerData(user) {
  return {
    full_name: `${tag} Cliente ${user.index}`,
    whatsapp: "5511999999999",
    email: user.email,
  };
}

async function callCreate(user, cartItems, key, notes, { legacy = false } = {}) {
  const args = {
    customer_data: customerData(user),
    address_data: addressData,
    cart_items: cartItems,
    requested_delivery_choice: "local_delivery_review",
    order_notes: notes,
    selected_shipping_quote_id: null,
  };
  if (!legacy) args.requested_idempotency_key = key;
  const startedAt = new Date().toISOString();
  const response = await user.client.rpc("create_customer_order", args);
  return {
    ok: !response.error,
    orderNumber: response.data?.[0]?.order_number ?? null,
    error: response.error
      ? {
          sqlstate: response.error.code ?? null,
          message: response.error.message,
          details: response.error.details ?? null,
        }
      : null,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function oneItem(catalog, variant, quantity = 1) {
  return [{
    product_id: catalog.productId,
    size: variant.size,
    color: variant.color,
    quantity,
  }];
}

async function orderByNumber(orderNumber) {
  const order = await requireData(
    service
      .from("orders")
      .select("id,order_number,address_id,customer_id,status,payment_status,total,stock_deducted_at")
      .eq("order_number", orderNumber)
      .single(),
    `read order ${orderNumber}`,
  );
  if (!created.orderIds.includes(order.id)) created.orderIds.push(order.id);
  if (!created.addressIds.includes(order.address_id)) created.addressIds.push(order.address_id);
  return order;
}

async function activeReservations(variantIds) {
  return requireData(
    service
      .from("inventory_reservations")
      .select("id,order_id,variant_id,quantity,status,expires_at,release_reason")
      .in("variant_id", variantIds)
      .eq("status", "active"),
    "read active reservations",
  );
}

async function cleanOrder(order) {
  await service.from("order_status_history").delete().eq("order_id", order.id);
  await service.from("shipping_decisions").delete().eq("order_id", order.id);
  await service.from("shipping_quotes").delete().eq("order_id", order.id);
  await service.from("payment_events").delete().in(
    "payment_id",
    created.paymentIds.length ? created.paymentIds : [randomUUID()],
  );
  await service.from("payments").delete().eq("order_id", order.id);
  await service.from("inventory_reservations").delete().eq("order_id", order.id);
  await service.from("order_items").delete().eq("order_id", order.id);
  await service.from("orders").delete().eq("id", order.id);
  await service.from("addresses").delete().eq("id", order.address_id);
}

async function cancelAndClean(order) {
  await requireData(
    service
      .from("orders")
      .update({ status: "cancelled", payment_status: "cancelled" })
      .eq("id", order.id),
    `cancel order ${order.order_number}`,
  );
  await cleanOrder(order);
}

async function stock(variantId) {
  const variant = await requireData(
    service.from("product_variants").select("stock").eq("id", variantId).single(),
    "read stock",
  );
  return variant.stock;
}

async function createPayment(order, suffix) {
  const payment = await requireData(
    service
      .from("payments")
      .insert({
        order_id: order.id,
        provider: "pagbank",
        external_reference: order.order_number,
        amount: order.total,
        status: "pending",
        checkout_id: `TEST-PRELOCK-${runId}-${suffix}`,
        provider_payload: {},
      })
      .select("id,checkout_id")
      .single(),
    "create synthetic payment",
  );
  created.paymentIds.push(payment.id);
  return payment;
}

async function confirmPaid(payment) {
  return service.rpc("confirm_pagbank_payment", {
    target_checkout_id: payment.checkout_id,
    confirmed_status: "paid",
    confirmed_method: "test",
    provider_raw_status: "PAID",
  });
}

async function phaseCleanupCheck(phase, variantIds) {
  const active = await activeReservations(variantIds);
  pass(`${phase}: no active synthetic reservation remains`, active.length === 0);
  await assertNoDatabaseWaits(phase);
}

async function cleanup() {
  const errors = [];
  async function removeEach(table, column, values) {
    for (const value of [...new Set(values)]) {
      const { error } = await service.from(table).delete().eq(column, value);
      if (error) errors.push(`${table}: ${error.code ?? "unknown"} ${error.message}`);
    }
  }

  const customers = created.userIds.length
    ? await service.from("customers").select("id").in("user_id", created.userIds)
    : { data: [], error: null };
  if (customers.error) errors.push(`read customers: ${customers.error.message}`);
  const customerIds = (customers.data ?? []).map((row) => row.id);
  const remainingOrders = customerIds.length
    ? await service.from("orders").select("id,address_id").in("customer_id", customerIds)
    : { data: [], error: null };
  if (remainingOrders.error) errors.push(`read orders: ${remainingOrders.error.message}`);
  const orderIds = [...new Set([
    ...created.orderIds,
    ...(remainingOrders.data ?? []).map((row) => row.id),
  ])];
  const addressIds = [...new Set([
    ...created.addressIds,
    ...(remainingOrders.data ?? []).map((row) => row.address_id),
  ])];

  await removeEach("payment_events", "payment_id", created.paymentIds);
  await removeEach("order_status_history", "order_id", orderIds);
  await removeEach("shipping_decisions", "order_id", orderIds);
  await removeEach("shipping_quotes", "order_id", orderIds);
  await removeEach("payments", "order_id", orderIds);
  await removeEach("inventory_reservations", "order_id", orderIds);
  await removeEach("order_items", "order_id", orderIds);
  await removeEach("orders", "id", orderIds);
  await removeEach("addresses", "id", addressIds);
  await removeEach("customers", "id", customerIds);
  await removeEach("products", "id", created.productIds);
  await removeEach(
    "audit_logs",
    "record_id",
    [...orderIds, ...created.paymentIds, ...created.productIds, ...created.variantIds],
  );

  for (const userId of created.userIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) errors.push(`auth user: ${error.code ?? "unknown"} ${error.message}`);
  }
  return errors;
}

const before = await counts();
let failure = null;
try {
  const existingOrders = await requireData(
    service.from("orders").select("id,order_number").limit(1),
    "read existing order",
  );
  const existingOrder = existingOrders[0] ?? null;
  const category = await requireData(
    service.from("categories").select("id").eq("slug", "tenis").single(),
    "read category",
  );
  const users = [];
  for (let index = 1; index <= 23; index += 1) {
    users.push(await createUser(index));
  }
  const catalog = await createCatalog(category.id);

  if (!onlyLockTimeout) {
  const raceVariant = catalog.variants.RACE100;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const results = await Promise.all(
      users.slice(0, 20).map((user) =>
        callCreate(
          user,
          oneItem(catalog, raceVariant),
          randomUUID(),
          `${tag} corrida-${iteration}`,
        )),
    );
    const winners = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    metrics.stockOneHundredRuns.winners += winners.length;
    metrics.stockOneHundredRuns.rejected += rejected.length;
    pass(`race ${iteration + 1}: one winner`, winners.length === 1);
    pass(`race ${iteration + 1}: nineteen rejected`, rejected.length === 19);
    pass(
      `race ${iteration + 1}: controlled errors`,
      rejected.every((result) =>
        result.error?.sqlstate === "P0001"
        && result.error?.message.includes("insufficient_available_stock")),
    );
    const reservations = await activeReservations([raceVariant.id]);
    pass(
      `race ${iteration + 1}: exactly one reservation`,
      reservations.length === 1 && reservations[0].quantity === 1,
    );
    const winnerOrder = await orderByNumber(winners[0].orderNumber);
    await cancelAndClean(winnerOrder);
    pass(`race ${iteration + 1}: stock remains one`, await stock(raceVariant.id) === 1);
  }
  pass(
    "100 races aggregate exact outcomes",
    metrics.stockOneHundredRuns.winners === 100
      && metrics.stockOneHundredRuns.rejected === 1900,
  );
  await phaseCleanupCheck("100 stock-one races", [raceVariant.id]);

  const stockTenVariant = catalog.variants.STOCK10;
  const stockTenResults = await Promise.all(
    users.slice(0, 20).map((user) =>
      callCreate(user, oneItem(catalog, stockTenVariant), randomUUID(), `${tag} estoque-10`)),
  );
  const stockTenWinners = stockTenResults.filter((result) => result.ok);
  const stockTenRejected = stockTenResults.filter((result) => !result.ok);
  metrics.stockTenRace.winners = stockTenWinners.length;
  metrics.stockTenRace.rejected = stockTenRejected.length;
  pass("stock ten race has ten winners", stockTenWinners.length === 10);
  pass("stock ten race has ten controlled rejections", stockTenRejected.length === 10);
  const stockTenReservations = await activeReservations([stockTenVariant.id]);
  pass(
    "stock ten race has no excess reservation",
    stockTenReservations.length === 10
      && stockTenReservations.reduce((sum, row) => sum + row.quantity, 0) === 10,
  );
  for (const winner of stockTenWinners) {
    await cancelAndClean(await orderByNumber(winner.orderNumber));
  }
  await phaseCleanupCheck("stock-ten race", [stockTenVariant.id]);

  const inverseA = catalog.variants["INVERSE-A"];
  const inverseB = catalog.variants["INVERSE-B"];
  const inverseResults = await Promise.all([
    callCreate(
      users[0],
      [...oneItem(catalog, inverseA), ...oneItem(catalog, inverseB)],
      randomUUID(),
      `${tag} inverse-forward`,
    ),
    callCreate(
      users[1],
      [...oneItem(catalog, inverseB), ...oneItem(catalog, inverseA)],
      randomUUID(),
      `${tag} inverse-reverse`,
    ),
  ]);
  const inverseWinners = inverseResults.filter((result) => result.ok);
  const inverseRejected = inverseResults.filter((result) => !result.ok);
  pass("inverse carts do not deadlock", inverseWinners.length === 1 && inverseRejected.length === 1);
  pass(
    "inverse loser receives stock error",
    inverseRejected[0].error?.message.includes("insufficient_available_stock"),
  );
  await cancelAndClean(await orderByNumber(inverseWinners[0].orderNumber));
  await phaseCleanupCheck("inverse carts", [inverseA.id, inverseB.id]);

  const atomicBefore = await service
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", users[20].userId);
  const atomicResult = await callCreate(
    users[20],
    [
      ...oneItem(catalog, catalog.variants["ATOMIC-A"]),
      ...oneItem(catalog, catalog.variants["ATOMIC-B"]),
    ],
    randomUUID(),
    `${tag} atomic-failure`,
  );
  pass(
    "multi-variant insufficient cart is rejected",
    !atomicResult.ok && atomicResult.error?.message.includes("insufficient_available_stock"),
  );
  const atomicAfter = await service
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", users[20].userId);
  pass("multi-variant failure creates no customer", atomicAfter.count === atomicBefore.count);
  await phaseCleanupCheck(
    "multi-variant atomic rollback",
    [catalog.variants["ATOMIC-A"].id, catalog.variants["ATOMIC-B"].id],
  );

  const idempotencyKey = randomUUID();
  const idemResults = await Promise.all(
    Array.from({ length: 20 }, () =>
      callCreate(
        users[0],
        oneItem(catalog, catalog.variants.IDEMPOTENCY),
        idempotencyKey,
        `${tag} idempotency`,
      )),
  );
  const idemNumbers = idemResults.map((result) => result.orderNumber);
  metrics.idempotency.responses = idemResults.length;
  metrics.idempotency.distinctOrders = new Set(idemNumbers).size;
  pass("same key returns twenty successes", idemResults.every((result) => result.ok));
  pass("same key returns one order", new Set(idemNumbers).size === 1);
  const idemReservations = await activeReservations([catalog.variants.IDEMPOTENCY.id]);
  pass("same key creates one reservation", idemReservations.length === 1);
  await cancelAndClean(await orderByNumber(idemNumbers[0]));
  await phaseCleanupCheck("idempotency race", [catalog.variants.IDEMPOTENCY.id]);

  const payVariant = catalog.variants["PAY-CREATE"];
  const oldPayCreate = await callCreate(
    users[0],
    oneItem(catalog, payVariant),
    randomUUID(),
    `${tag} payment-existing`,
  );
  pass("payment race setup order succeeds", oldPayCreate.ok);
  const paidOrder = await orderByNumber(oldPayCreate.orderNumber);
  const payment = await createPayment(paidOrder, "PAY-CREATE");
  const [paymentResult, competingCreate] = await Promise.all([
    confirmPaid(payment),
    callCreate(
      users[1],
      oneItem(catalog, payVariant),
      randomUUID(),
      `${tag} payment-competing-create`,
    ),
  ]);
  pass("payment confirmation succeeds during creation", !paymentResult.error);
  pass(
    "competing creation cannot oversell",
    !competingCreate.ok
      && competingCreate.error?.message.includes("insufficient_available_stock"),
  );
  pass("payment race decrements stock once", await stock(payVariant.id) === 0);
  const repeatedPaid = await confirmPaid(payment);
  pass("repeated payment remains idempotent", !repeatedPaid.error && await stock(payVariant.id) === 0);
  await cleanOrder(paidOrder);
  await requireData(
    service.from("product_variants").update({ stock: 1 }).eq("id", payVariant.id),
    "reset paid test stock",
  );
  await phaseCleanupCheck("payment versus creation", [payVariant.id]);

  const cancelVariant = catalog.variants["CANCEL-CREATE"];
  const cancelSetup = await callCreate(
    users[0],
    oneItem(catalog, cancelVariant),
    randomUUID(),
    `${tag} cancellation-existing`,
  );
  const cancelOrder = await orderByNumber(cancelSetup.orderNumber);
  const [cancelMutation, cancelCompeting] = await Promise.all([
    service
      .from("orders")
      .update({ status: "cancelled", payment_status: "cancelled" })
      .eq("id", cancelOrder.id),
    callCreate(
      users[1],
      oneItem(catalog, cancelVariant),
      randomUUID(),
      `${tag} cancellation-competing`,
    ),
  ]);
  pass("concurrent cancellation succeeds", !cancelMutation.error);
  let cancellationWinner = cancelCompeting;
  if (!cancellationWinner.ok) {
    cancellationWinner = await callCreate(
      users[1],
      oneItem(catalog, cancelVariant),
      randomUUID(),
      `${tag} cancellation-retry`,
    );
  }
  pass("released cancellation stock becomes purchasable", cancellationWinner.ok);
  const cancelActive = await activeReservations([cancelVariant.id]);
  pass("cancellation race never has excess reservation", cancelActive.length === 1);
  await cleanOrder(cancelOrder);
  await cancelAndClean(await orderByNumber(cancellationWinner.orderNumber));
  await phaseCleanupCheck("cancellation versus creation", [cancelVariant.id]);

  const expireVariant = catalog.variants["EXPIRE-CREATE"];
  const expireSetup = await callCreate(
    users[0],
    oneItem(catalog, expireVariant),
    randomUUID(),
    `${tag} expiration-existing`,
  );
  const expireOrder = await orderByNumber(expireSetup.orderNumber);
  await requireData(
    service
      .from("inventory_reservations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("order_id", expireOrder.id),
    "age expiration reservation",
  );
  const [releaseResult, expireCompeting] = await Promise.all([
    service.rpc("release_order_stock_reservation", {
      target_order_id: expireOrder.id,
      requested_reason: "synthetic_expiration",
    }),
    callCreate(
      users[1],
      oneItem(catalog, expireVariant),
      randomUUID(),
      `${tag} expiration-competing`,
    ),
  ]);
  pass("concurrent expiration release succeeds", !releaseResult.error);
  pass("expired reservation allows exactly one new purchase", expireCompeting.ok);
  const expireActive = await activeReservations([expireVariant.id]);
  pass("expiration race has one active reservation", expireActive.length === 1);
  await cleanOrder(expireOrder);
  await cancelAndClean(await orderByNumber(expireCompeting.orderNumber));
  await phaseCleanupCheck("expiration versus creation", [expireVariant.id]);
  }

  const timeoutVariant = catalog.variants["LOCK-TIMEOUT"];
  const lockApplicationName = `bispo_prelock_${runId.replaceAll("-", "_")}`;
  const lockSql = `begin;
    set local application_name = '${lockApplicationName}';
    select variants.id
    from public.product_variants as variants
    where variants.id = '${timeoutVariant.id}'::uuid
    for update;
    select pg_sleep(30);
    rollback;`.replace(/\s+/g, " ").trim();
  let lockHolderError = null;
  const lockHolderStartedAt = Date.now();
  const lockHolder = supabaseCli(["db", "query", "--linked", lockSql])
    .then((result) => {
      metrics.lockTimeout.holderDurationMs = Date.now() - lockHolderStartedAt;
      return result;
    })
    .catch((error) => {
      metrics.lockTimeout.holderDurationMs = Date.now() - lockHolderStartedAt;
      lockHolderError = error;
      return null;
    });
  // A inspeção manual mostrou a sessão em PgSleep depois de oito segundos.
  // Não abrimos uma segunda CLI aqui porque a Management API serializa a
  // criação da login role temporária e pode responder 502 sob concorrência.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  if (lockHolderError) throw lockHolderError;
  const timeoutResult = await callCreate(
    users[21],
    oneItem(catalog, timeoutVariant),
    randomUUID(),
    `${tag} lock-timeout`,
  );
  await lockHolder;
  if (lockHolderError) {
    throw new Error(`lock holder failed after ${metrics.lockTimeout.holderDurationMs}ms: ${lockHolderError.message}`);
  }
  pass(
    "lock timeout is controlled",
    !timeoutResult.ok
      && timeoutResult.error?.sqlstate === "55P03"
      && timeoutResult.error?.message.includes("lock timeout"),
    JSON.stringify({ timeoutResult, lockHolder: metrics.lockTimeout }),
  );
  const timeoutOrders = await service
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", users[21].userId);
  pass("lock timeout leaves no customer or partial order", timeoutOrders.count === 0);
  await phaseCleanupCheck("lock timeout", [timeoutVariant.id]);

  const legacyResult = await callCreate(
    users[0],
    oneItem(catalog, catalog.variants.LEGACY),
    null,
    `${tag} legacy`,
    { legacy: true },
  );
  pass("legacy six-argument RPC still works", legacyResult.ok);
  await cancelAndClean(await orderByNumber(legacyResult.orderNumber));
  await phaseCleanupCheck("legacy RPC", [catalog.variants.LEGACY.id]);

  const adminVariant = catalog.variants.ADMIN;
  const [adminMutation, adminCreate] = await Promise.all([
    service.rpc("replace_product_variants", {
      target_product_id: catalog.productId,
      variants_data: Object.values(catalog.variants).map((variant) => ({
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        stock: variant.size === "PAY-CREATE" ? 1 : variant.stock,
        active: variant.active,
      })),
    }),
    callCreate(
      users[2],
      oneItem(catalog, adminVariant),
      randomUUID(),
      `${tag} admin-stock`,
    ),
  ]);
  pass("admin stock RPC completes without deadlock", !adminMutation.error);
  pass("creation concurrent with admin stock update succeeds", adminCreate.ok);
  await cancelAndClean(await orderByNumber(adminCreate.orderNumber));
  await phaseCleanupCheck("admin stock versus creation", [adminVariant.id]);

  const privateFunction = await users[0].client.rpc("lock_and_validate_cart_inventory", {
    cart_items: oneItem(catalog, catalog.variants.RACE100),
  });
  pass("authenticated cannot execute private lock helper", Boolean(privateFunction.error));
  const nonAdminReplace = await users[0].client.rpc("replace_product_variants", {
    target_product_id: catalog.productId,
    variants_data: [],
  });
  pass(
    "non-admin cannot replace variants",
    nonAdminReplace.error?.code === "42501" || nonAdminReplace.error?.message.includes("admin_required"),
  );
  const anonReservations = await anon.from("inventory_reservations").select("id").limit(1);
  const authReservations = await users[0].client
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  pass("anon cannot read inventory_reservations", Boolean(anonReservations.error));
  pass("authenticated cannot read inventory_reservations", Boolean(authReservations.error));
  await assertNoDatabaseWaits("security and compatibility");

  if (existingOrder) {
    const preserved = await requireData(
      service.from("orders").select("id,order_number").eq("id", existingOrder.id).single(),
      "read preserved real order",
    );
    pass("pre-existing real order remains accessible", preserved.order_number === existingOrder.order_number);
  } else {
    checks.push("no pre-existing order existed to verify");
  }
} catch (error) {
  failure = error;
} finally {
  let cleanupErrors = await cleanup();
  if (cleanupErrors.length) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    cleanupErrors = await cleanup();
  }
  const after = await counts();
  let finalBlocking = null;
  try {
    finalBlocking = await supabaseCli(["inspect", "db", "blocking", "--linked"]);
  } catch (error) {
    cleanupErrors.push(`final blocking inspection: ${error.message}`);
  }
  const result = {
    runId,
    projectHost: EXPECTED_PROJECT_HOST,
    metrics,
    checksPassed: checks.length,
    cleanupErrors,
    countsBefore: before,
    countsAfter: after,
    countsPreserved: JSON.stringify(before) === JSON.stringify(after),
    finalBlockedSessions: finalBlocking?.rows?.length ?? null,
    failure: failure ? { name: failure.name, message: failure.message } : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    failure
    || cleanupErrors.length
    || !result.countsPreserved
    || result.finalBlockedSessions !== 0
  ) {
    process.exitCode = 1;
  }
}
