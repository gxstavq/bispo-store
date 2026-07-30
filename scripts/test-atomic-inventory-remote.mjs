import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  consultedPagBankCheckoutMatchesPayment,
  storedPagBankPaymentMatchesOrder,
} from "../services/pagbank/consistency.ts";

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
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente para este teste.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const tag = `[TESTE ATOMICO ${runId}]`;
const createdUserIds = [];
const createdProductIds = [];
const createdVariantIds = [];
const checks = [];
const metrics = {
  twoWayRaces: { iterations: 50, winners: 0, rejected: 0 },
  twentyWayRace: { calls: 20, winners: 0, rejected: 0 },
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
  const names = [
    "products",
    "product_images",
    "product_variants",
    "admin_users",
    "orders",
    "customers",
    "addresses",
    "payments",
    "inventory_reservations",
    "store_settings",
    "integration_credentials",
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

async function createTestUser(index) {
  const email = `bispo-atomic-${runId}-${index}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const created = await requireData(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
    `create auth user ${index}`,
  );
  createdUserIds.push(created.user.id);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await requireData(client.auth.signInWithPassword({ email, password }), `sign in user ${index}`);
  return { client, email, index, userId: created.user.id };
}

async function createProduct(categoryId, suffix, variants) {
  const product = await requireData(
    service
      .from("products")
      .insert({
        category_id: categoryId,
        name: `${tag} ${suffix}`,
        slug: `teste-atomico-${runId}-${suffix}`,
        code: `TEST-ATOMIC-${runId}-${suffix}`,
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
    `create product ${suffix}`,
  );
  createdProductIds.push(product.id);
  const rows = await requireData(
    service
      .from("product_variants")
      .insert(variants.map((variant, index) => ({
        product_id: product.id,
        sku: `TEST-ATOMIC-${runId}-${suffix}-${index}`,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
        active: true,
      })))
      .select("id,size,color,stock"),
    `create variants ${suffix}`,
  );
  createdVariantIds.push(...rows.map((row) => row.id));
  return { id: product.id, variants: rows };
}

function customerData(user) {
  return {
    full_name: `${tag} Cliente ${user.index}`,
    whatsapp: "5511999999999",
    email: user.email,
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

async function callCreate(user, cartItems, key, notes = tag, legacy = false) {
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

async function orderByNumber(orderNumber) {
  return requireData(
    service
      .from("orders")
      .select(`
        id,order_number,total,customer_id,address_id,status,payment_status,
        stock_deducted_at,stock_deduction_error
      `)
      .eq("order_number", orderNumber)
      .single(),
    `read order ${orderNumber}`,
  );
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

async function createPayment(order, suffix) {
  return requireData(
    service
      .from("payments")
      .insert({
        order_id: order.id,
        provider: "pagbank",
        external_reference: order.order_number,
        amount: order.total,
        status: "pending",
        checkout_id: `TEST-ATOMIC-${runId}-${suffix}`,
        provider_payload: {},
      })
      .select("id,checkout_id")
      .single(),
    `create payment ${suffix}`,
  );
}

async function cleanup() {
  const errors = [];
  const { data: customers, error: customersReadError } = createdUserIds.length
    ? await service
        .from("customers")
        .select("id")
        .in("user_id", createdUserIds)
    : { data: [], error: null };
  if (customersReadError) errors.push(`read customers: ${customersReadError.message}`);
  const customerIds = (customers ?? []).map((row) => row.id);
  const { data: orders, error: ordersReadError } = customerIds.length
    ? await service
        .from("orders")
        .select("id,customer_id,address_id")
        .in("customer_id", customerIds)
    : { data: [], error: null };
  if (ordersReadError) errors.push(`read orders: ${ordersReadError.message}`);
  const orderIds = (orders ?? []).map((row) => row.id);
  const addressIds = [...new Set((orders ?? []).map((row) => row.address_id))];

  async function removeEach(label, table, column, values) {
    for (const value of values) {
      const { error } = await service.from(table).delete().eq(column, value);
      if (error) errors.push(`${label}: ${error.code ?? "unknown"} ${error.message}`);
    }
  }

  if (orderIds.length) {
    await removeEach(
      "order history",
      "order_status_history",
      "order_id",
      orderIds,
    );
    await removeEach(
      "shipping decisions",
      "shipping_decisions",
      "order_id",
      orderIds,
    );
    await removeEach(
      "shipping quotes",
      "shipping_quotes",
      "order_id",
      orderIds,
    );
    await removeEach("payments", "payments", "order_id", orderIds);
    await removeEach(
      "reservations",
      "inventory_reservations",
      "order_id",
      orderIds,
    );
    await removeEach("orders", "orders", "id", orderIds);
  }
  if (addressIds.length) {
    await removeEach("addresses", "addresses", "id", addressIds);
  }
  if (customerIds.length) {
    await removeEach("customers", "customers", "id", customerIds);
  }
  if (createdProductIds.length) {
    await removeEach("products", "products", "id", createdProductIds);
  }
  const auditIds = [...orderIds, ...createdProductIds, ...createdVariantIds];
  if (auditIds.length) {
    await removeEach("audit logs", "audit_logs", "record_id", auditIds);
  }
  for (const userId of createdUserIds) {
    let deleted = false;
    for (let attempt = 0; attempt < 3 && !deleted; attempt += 1) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (!error) deleted = true;
      else if (attempt === 2) {
        errors.push(`auth user: ${error.code ?? "unknown"} ${error.message ?? "unknown"}`);
      }
    }
  }
  return errors;
}

const before = await counts();
let failure = null;
try {
  const category = await requireData(
    service.from("categories").select("id").eq("slug", "tenis").single(),
    "read category",
  );
  const users = [];
  for (let index = 0; index < 23; index += 1) {
    users.push(await createTestUser(index + 1));
  }

  for (let iteration = 0; iteration < 50; iteration += 1) {
    const product = await createProduct(category.id, `race-${iteration}`, [
      { size: "40", color: "Preto", stock: 1 },
    ]);
    const variant = product.variants[0];
    const keyA = randomUUID();
    const keyB = randomUUID();
    const results = await Promise.all([
      callCreate(
        users[0],
        [{ product_id: product.id, size: variant.size, color: variant.color, quantity: 1 }],
        keyA,
      ),
      callCreate(
        users[1],
        [{ product_id: product.id, size: variant.size, color: variant.color, quantity: 1 }],
        keyB,
      ),
    ]);
    const winners = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    metrics.twoWayRaces.winners += winners.length;
    metrics.twoWayRaces.rejected += rejected.length;
    pass(`race ${iteration + 1}: one winner`, winners.length === 1);
    pass(`race ${iteration + 1}: one rejected`, rejected.length === 1);
    pass(
      `race ${iteration + 1}: controlled stock error`,
      rejected[0].error?.sqlstate === "P0001"
        && rejected[0].error?.message.includes("insufficient_available_stock"),
    );
    const reservations = await activeReservations([variant.id]);
    pass(`race ${iteration + 1}: one active reservation`, reservations.length === 1);
    const variantAfter = await requireData(
      service.from("product_variants").select("stock").eq("id", variant.id).single(),
      "read race stock",
    );
    pass(`race ${iteration + 1}: stock remains nonnegative`, variantAfter.stock === 1);
  }

  const twentyProduct = await createProduct(category.id, "twenty", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const twentyVariant = twentyProduct.variants[0];
  const twentyResults = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      callCreate(
        users[index + 2],
        [{
          product_id: twentyProduct.id,
          size: twentyVariant.size,
          color: twentyVariant.color,
          quantity: 1,
        }],
        randomUUID(),
      )),
  );
  metrics.twentyWayRace.winners = twentyResults.filter((result) => result.ok).length;
  metrics.twentyWayRace.rejected = twentyResults.filter((result) => !result.ok).length;
  metrics.twentyWayRace.errorDistribution = Object.fromEntries(
    [...new Set(
      twentyResults
        .filter((result) => !result.ok)
        .map((result) => `${result.error?.sqlstate}:${result.error?.message}`),
    )].map((key) => [
      key,
      twentyResults.filter((result) =>
        `${result.error?.sqlstate}:${result.error?.message}` === key).length,
    ]),
  );
  pass("20-way race: one winner", metrics.twentyWayRace.winners === 1);
  pass("20-way race: nineteen rejected", metrics.twentyWayRace.rejected === 19);
  pass(
    "20-way race: all losers receive controlled stock errors",
    twentyResults
      .filter((result) => !result.ok)
      .every((result) =>
        result.error?.sqlstate === "P0001"
        && result.error?.message.includes("insufficient_available_stock")),
  );
  pass(
    "20-way race: only one active reservation",
    (await activeReservations([twentyVariant.id])).length === 1,
  );

  const idemProduct = await createProduct(category.id, "idempotency", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const idemVariant = idemProduct.variants[0];
  const idemKey = randomUUID();
  const idemCalls = await Promise.all(
    Array.from({ length: 20 }, () =>
      callCreate(
        users[2],
        [{
          product_id: idemProduct.id,
          size: idemVariant.size,
          color: idemVariant.color,
          quantity: 1,
        }],
        idemKey,
      )),
  );
  pass("same key: all calls succeed", idemCalls.every((result) => result.ok));
  pass(
    "same key: all calls return the same order",
    new Set(idemCalls.map((result) => result.orderNumber)).size === 1,
  );
  const divergent = await callCreate(
    users[2],
    [{
      product_id: idemProduct.id,
      size: idemVariant.size,
      color: idemVariant.color,
      quantity: 1,
    }],
    idemKey,
    `${tag} payload divergente`,
  );
  pass(
    "same key with different payload is rejected",
    !divergent.ok
      && divergent.error?.message.includes("idempotency_key_reused_with_different_payload"),
  );

  const multiAvailable = await createProduct(category.id, "multi-available", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const multiUnavailable = await createProduct(category.id, "multi-unavailable", [
    { size: "41", color: "Branco", stock: 0 },
  ]);
  const multiKey = randomUUID();
  const multiResult = await callCreate(
    users[22],
    [
      {
        product_id: multiAvailable.id,
        size: multiAvailable.variants[0].size,
        color: multiAvailable.variants[0].color,
        quantity: 1,
      },
      {
        product_id: multiUnavailable.id,
        size: multiUnavailable.variants[0].size,
        color: multiUnavailable.variants[0].color,
        quantity: 1,
      },
    ],
    multiKey,
  );
  pass("multi-variant failure is rejected", !multiResult.ok);
  const partialOrders = await requireData(
    service.from("orders").select("id").eq("idempotency_key", multiKey),
    "read possible partial order",
  );
  pass("multi-variant failure leaves no order", partialOrders.length === 0);
  pass(
    "multi-variant failure leaves no reservation",
    (await activeReservations([
      multiAvailable.variants[0].id,
      multiUnavailable.variants[0].id,
    ])).length === 0,
  );
  const partialCustomer = await requireData(
    service.from("customers").select("id").eq("user_id", users[22].userId),
    "read possible partial customer",
  );
  pass("multi-variant failure leaves no customer or address", partialCustomer.length === 0);

  const inverseProduct = await createProduct(category.id, "inverse", [
    { size: "40", color: "Preto", stock: 1 },
    { size: "41", color: "Preto", stock: 1 },
  ]);
  const [inverseA, inverseB] = inverseProduct.variants;
  const inverseRace = Promise.all([
    callCreate(
      users[4],
      [
        { product_id: inverseProduct.id, size: inverseA.size, color: inverseA.color, quantity: 1 },
        { product_id: inverseProduct.id, size: inverseB.size, color: inverseB.color, quantity: 1 },
      ],
      randomUUID(),
    ),
    callCreate(
      users[5],
      [
        { product_id: inverseProduct.id, size: inverseB.size, color: inverseB.color, quantity: 1 },
        { product_id: inverseProduct.id, size: inverseA.size, color: inverseA.color, quantity: 1 },
      ],
      randomUUID(),
    ),
  ]);
  let inverseTimeout;
  const inverseResults = await Promise.race([
    inverseRace,
    new Promise((_, reject) => {
      inverseTimeout = setTimeout(
        () => reject(new Error("inverse_order_deadlock_timeout")),
        10_000,
      );
    }),
  ]).finally(() => clearTimeout(inverseTimeout));
  pass("inverse order: no deadlock", Array.isArray(inverseResults));
  pass("inverse order: one winner", inverseResults.filter((result) => result.ok).length === 1);
  pass("inverse order: one rejected", inverseResults.filter((result) => !result.ok).length === 1);

  const terminalStatuses = ["declined", "cancelled", "expired"];
  for (const status of terminalStatuses) {
    const product = await createProduct(category.id, `terminal-${status}`, [
      { size: "40", color: "Preto", stock: 1 },
    ]);
    const created = await callCreate(
      users[0],
      [{
        product_id: product.id,
        size: product.variants[0].size,
        color: product.variants[0].color,
        quantity: 1,
      }],
      randomUUID(),
    );
    pass(`${status}: order created`, created.ok);
    const order = await orderByNumber(created.orderNumber);
    const payment = await createPayment(order, status);
    if (status === "expired") {
      await requireData(
        service
          .from("inventory_reservations")
          .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
          .eq("order_id", order.id),
        "age expiration reservation",
      );
    }
    await requireData(
      service.rpc("confirm_pagbank_payment", {
        target_checkout_id: payment.checkout_id,
        confirmed_status: status,
        confirmed_method: "test",
        provider_raw_status: status.toUpperCase(),
      }),
      `confirm ${status}`,
    );
    const reservation = await requireData(
      service
        .from("inventory_reservations")
        .select("status,release_reason")
        .eq("order_id", order.id)
        .single(),
      `read ${status} reservation`,
    );
    pass(
      `${status}: reservation released`,
      ["released", "expired"].includes(reservation.status),
    );
  }

  const paymentProduct = await createProduct(category.id, "payment", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const paymentCreated = await callCreate(
    users[1],
    [{
      product_id: paymentProduct.id,
      size: paymentProduct.variants[0].size,
      color: paymentProduct.variants[0].color,
      quantity: 1,
    }],
    randomUUID(),
  );
  const paymentOrder = await orderByNumber(paymentCreated.orderNumber);
  const reservationBefore = await requireData(
    service
      .from("inventory_reservations")
      .select("expires_at")
      .eq("order_id", paymentOrder.id)
      .single(),
    "read initial payment reservation",
  );
  const payment = await createPayment(paymentOrder, "paid");
  const paymentBeforeDivergence = await requireData(
    service
      .from("payments")
      .select("id,status,amount,checkout_id,external_reference")
      .eq("id", payment.id)
      .single(),
    "read payment before divergence checks",
  );
  pass(
    "divergent reference is rejected before database mutation",
    !storedPagBankPaymentMatchesOrder({
      paymentAmount: paymentOrder.total,
      orderTotal: paymentOrder.total,
      orderNumber: paymentOrder.order_number,
      webhookReferenceId: "BSP-DIVERGENTE",
    }),
  );
  pass(
    "divergent amount is rejected before database mutation",
    !consultedPagBankCheckoutMatchesPayment({
      checkoutId: payment.checkout_id,
      referenceId: paymentOrder.order_number,
      totalCents: Math.round((Number(paymentOrder.total) + 1) * 100),
      expectedCheckoutId: payment.checkout_id,
      expectedOrderNumber: paymentOrder.order_number,
      expectedAmount: paymentOrder.total,
    }),
  );
  const paymentAfterDivergence = await requireData(
    service
      .from("payments")
      .select("id,status,amount,checkout_id,external_reference")
      .eq("id", payment.id)
      .single(),
    "read payment after divergence checks",
  );
  pass(
    "divergent payloads leave the real payment unchanged",
    JSON.stringify(paymentBeforeDivergence) === JSON.stringify(paymentAfterDivergence),
  );

  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "pending",
      confirmed_method: "credit_card",
      provider_raw_status: "WAITING",
    }),
    "confirm pending",
  );
  const pendingOrder = await orderByNumber(paymentCreated.orderNumber);
  const pendingVariant = await requireData(
    service
      .from("product_variants")
      .select("stock")
      .eq("id", paymentProduct.variants[0].id)
      .single(),
    "read pending stock",
  );
  pass("pending maps order to awaiting_payment", pendingOrder.payment_status === "awaiting_payment");
  pass("pending does not deduct stock", pendingVariant.stock === 1);
  pass(
    "pending does not duplicate reservation",
    (await activeReservations([paymentProduct.variants[0].id])).length === 1,
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "in_analysis",
      confirmed_method: "credit_card",
      provider_raw_status: "IN_ANALYSIS",
    }),
    "confirm in analysis",
  );
  const reservationAfterAnalysis = await requireData(
    service
      .from("inventory_reservations")
      .select("expires_at,status")
      .eq("order_id", paymentOrder.id)
      .single(),
    "read extended reservation",
  );
  pass(
    "IN_ANALYSIS extends reservation",
    new Date(reservationAfterAnalysis.expires_at).getTime()
      > new Date(reservationBefore.expires_at).getTime(),
  );
  const concurrentPaid = await Promise.all([
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "credit_card",
      provider_raw_status: "PAID",
    }),
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "credit_card",
      provider_raw_status: "PAID",
    }),
  ]);
  pass(
    "simultaneous payment confirmations both return idempotently",
    concurrentPaid.every((result) => !result.error),
    concurrentPaid.find((result) => result.error)?.error?.message,
  );
  const firstPaidVariant = await requireData(
    service
      .from("product_variants")
      .select("stock")
      .eq("id", paymentProduct.variants[0].id)
      .single(),
    "read first paid stock",
  );
  const firstPaidOrder = await orderByNumber(paymentCreated.orderNumber);
  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "credit_card",
      provider_raw_status: "PAID",
    }),
    "repeat paid webhook confirmation",
  );
  const repeatedPaidVariant = await requireData(
    service
      .from("product_variants")
      .select("stock")
      .eq("id", paymentProduct.variants[0].id)
      .single(),
    "read repeated paid stock",
  );
  const repeatedPaidOrder = await orderByNumber(paymentCreated.orderNumber);
  const consumed = await requireData(
    service
      .from("inventory_reservations")
      .select("status")
      .eq("order_id", paymentOrder.id)
      .single(),
    "read consumed reservation",
  );
  pass("paid consumes reservation", consumed.status === "consumed");
  pass("paid decrements stock once", firstPaidVariant.stock === 0);
  pass("repeated webhook does not decrement again", repeatedPaidVariant.stock === 0);
  pass(
    "repeated webhook preserves stock deduction timestamp",
    firstPaidOrder.stock_deducted_at === repeatedPaidOrder.stock_deducted_at,
  );
  pass("stock never negative after payment", repeatedPaidVariant.stock >= 0);

  const eventId = `TEST-ATOMIC-EVENT-${runId}`;
  await requireData(
    service.from("payment_events").insert({
      payment_id: payment.id,
      provider: "pagbank",
      event_type: "webhook_verified",
      provider_event_id: eventId,
      provider_status: "PAID",
      verified: true,
      payload: { synthetic: true },
    }),
    "insert first webhook event",
  );
  const duplicateEvent = await service.from("payment_events").insert({
    payment_id: payment.id,
    provider: "pagbank",
    event_type: "webhook_verified",
    provider_event_id: eventId,
    provider_status: "PAID",
    verified: true,
    payload: { synthetic: true },
  });
  pass("duplicate webhook event is rejected by unique constraint", duplicateEvent.error?.code === "23505");
  const storedEvents = await requireData(
    service
      .from("payment_events")
      .select("id")
      .eq("provider", "pagbank")
      .eq("provider_event_id", eventId),
    "read duplicate webhook events",
  );
  pass("duplicate webhook persists only one event", storedEvents.length === 1);

  const lateProduct = await createProduct(category.id, "paid-without-reservation", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const lateCreated = await callCreate(
    users[3],
    [{
      product_id: lateProduct.id,
      size: lateProduct.variants[0].size,
      color: lateProduct.variants[0].color,
      quantity: 1,
    }],
    randomUUID(),
  );
  pass("late payment scenario creates the order", lateCreated.ok);
  const lateOrder = await orderByNumber(lateCreated.orderNumber);
  await requireData(
    service.rpc("release_order_stock_reservation", {
      target_order_id: lateOrder.id,
      requested_reason: "synthetic_expired_before_payment",
    }),
    "release late payment reservation",
  );
  await requireData(
    service
      .from("product_variants")
      .update({ stock: 0 })
      .eq("id", lateProduct.variants[0].id),
    "simulate stock allocated to another order",
  );
  const latePayment = await createPayment(lateOrder, "late-without-stock");
  const lateConfirmation = await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: latePayment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "boleto",
      provider_raw_status: "PAID",
    }),
    "confirm late payment without stock",
  );
  const lateConfirmationRow = Array.isArray(lateConfirmation)
    ? lateConfirmation[0]
    : lateConfirmation;
  const lateOrderAfter = await orderByNumber(lateCreated.orderNumber);
  const lateVariantAfter = await requireData(
    service
      .from("product_variants")
      .select("stock")
      .eq("id", lateProduct.variants[0].id)
      .single(),
    "read late payment stock",
  );
  const latePaymentAfter = await requireData(
    service
      .from("payments")
      .select("status,last_error")
      .eq("id", latePayment.id)
      .single(),
    "read late payment administrative signal",
  );
  pass("late payment stays marked paid", lateOrderAfter.payment_status === "paid");
  pass("late payment reports stock error", Boolean(lateConfirmationRow?.stock_error));
  pass("late payment persists administrative stock signal", Boolean(lateOrderAfter.stock_deduction_error));
  pass("late payment persists payment error", Boolean(latePaymentAfter.last_error));
  pass("late payment never creates negative stock", lateVariantAfter.stock === 0);

  const legacyProduct = await createProduct(category.id, "legacy", [
    { size: "40", color: "Preto", stock: 1 },
  ]);
  const legacy = await callCreate(
    users[2],
    [{
      product_id: legacyProduct.id,
      size: legacyProduct.variants[0].size,
      color: legacyProduct.variants[0].color,
      quantity: 1,
    }],
    null,
    tag,
    true,
  );
  pass("legacy RPC remains functional", legacy.ok);
  const legacyOrder = await orderByNumber(legacy.orderNumber);
  pass(
    "legacy RPC creates reservation atomically",
    (await requireData(
      service
        .from("inventory_reservations")
        .select("id")
        .eq("order_id", legacyOrder.id),
      "read legacy reservation",
    )).length === 1,
  );

  const anonReservationRead = await anon.from("inventory_reservations").select("id").limit(1);
  pass("anon cannot read inventory_reservations", Boolean(anonReservationRead.error));
  const authReservationRead = await users[0].client
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  pass(
    "authenticated cannot read inventory_reservations",
    Boolean(authReservationRead.error),
  );
  const serviceReservationRead = await service
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  pass("service role can read inventory_reservations", !serviceReservationRead.error);
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = await cleanup();
  const after = await counts();
  const result = {
    runId,
    projectHost: EXPECTED_PROJECT_HOST,
    metrics,
    checksPassed: checks.length,
    cleanupErrors,
    countsBefore: before,
    countsAfter: after,
    countsPreserved: JSON.stringify(before) === JSON.stringify(after),
    failure: failure ? { name: failure.name, message: failure.message } : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (cleanupErrors.length || !result.countsPreserved || failure) process.exitCode = 1;
}
