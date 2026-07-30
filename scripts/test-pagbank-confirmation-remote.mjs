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
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente neste teste.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const tag = `[TESTE PAGBANK ${runId}]`;
const created = {
  userIds: [],
  productIds: [],
  variantIds: [],
  customerIds: [],
  addressIds: [],
  orderIds: [],
  paymentIds: [],
};
const checks = [];

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  checks.push(name);
}

async function requireData(promise, label) {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${label}: ${error.code ?? "unknown"} ${error.message}`);
  }
  return data;
}

async function counts() {
  const tables = [
    "products",
    "product_images",
    "product_variants",
    "admin_users",
    "orders",
    "order_items",
    "customers",
    "addresses",
    "payments",
    "payment_events",
    "inventory_reservations",
    "store_settings",
    "integration_credentials",
    "audit_logs",
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

async function createUser() {
  const email = `bispo-pagbank-${runId}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const authResult = await requireData(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
    "create auth user",
  );
  created.userIds.push(authResult.user.id);
  const authenticated = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await requireData(
    authenticated.auth.signInWithPassword({ email, password }),
    "sign in synthetic user",
  );
  return { authenticated, email, userId: authResult.user.id };
}

async function createCatalog(categoryId) {
  const product = await requireData(
    service
      .from("products")
      .insert({
        category_id: categoryId,
        name: `${tag} Produto`,
        slug: `teste-pagbank-${runId}`,
        code: `TEST-PAGBANK-${runId}`,
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
  const variantDefinitions = [
    ["PENDING", 3],
    ["ANALYSIS", 3],
    ["PAID", 1],
    ["DECLINED", 1],
    ["CANCELLED", 1],
    ["EXPIRED", 1],
    ["DIVERGENCE", 2],
    ["NORESERVATION", 0],
    ["STATUSES", 2],
  ];
  const variants = await requireData(
    service
      .from("product_variants")
      .insert(variantDefinitions.map(([size, stock], index) => ({
        product_id: product.id,
        sku: `TEST-PAGBANK-${runId}-${index}`,
        size,
        color: "Preto",
        stock,
        active: true,
      })))
      .select("id,size,stock"),
    "create synthetic variants",
  );
  created.variantIds.push(...variants.map((variant) => variant.id));
  return {
    productId: product.id,
    variants: Object.fromEntries(variants.map((variant) => [variant.size, variant])),
  };
}

async function createCustomerAndAddress(user) {
  const customer = await requireData(
    service
      .from("customers")
      .insert({
        user_id: user.userId,
        full_name: `${tag} Cliente`,
        whatsapp: "5511999999999",
        email: user.email,
      })
      .select("id")
      .single(),
    "create synthetic customer",
  );
  created.customerIds.push(customer.id);
  const address = await requireData(
    service
      .from("addresses")
      .insert({
        customer_id: customer.id,
        postal_code: "03870-100",
        street: "Avenida São Miguel",
        number: "5046",
        complement: "TESTE DESCARTÁVEL",
        district: "Ponte Rasa",
        city: "São Paulo",
        state: "SP",
        reference: tag,
      })
      .select("id")
      .single(),
    "create synthetic address",
  );
  created.addressIds.push(address.id);
  return { customerId: customer.id, addressId: address.id };
}

async function createOrder(context, catalog, variant, suffix, { reserve = true } = {}) {
  const order = await requireData(
    service
      .from("orders")
      .insert({
        order_number: `BSP-TEST-${runId}-${suffix}`.toUpperCase(),
        customer_id: context.customerId,
        address_id: context.addressId,
        status: "awaiting_payment",
        delivery_choice: "local_delivery_review",
        subtotal: 100,
        shipping_amount: 0,
        payment_status: "awaiting_payment",
        shipping_status: "free_approved",
        notes: tag,
        idempotency_key: randomUUID(),
        idempotency_fingerprint: randomUUID().replaceAll("-", ""),
      })
      .select("id,order_number,total,status,payment_status,stock_deducted_at,stock_deduction_error")
      .single(),
    `create order ${suffix}`,
  );
  created.orderIds.push(order.id);
  await requireData(
    service
      .from("order_items")
      .insert({
        order_id: order.id,
        product_id: catalog.productId,
        variant_id: variant.id,
        product_snapshot: {
          name: `${tag} Produto`,
          code: `TEST-PAGBANK-${runId}`,
          size: variant.size,
          color: "Preto",
        },
        quantity: 1,
        unit_price: 100,
      }),
    `create order item ${suffix}`,
  );
  if (reserve) {
    await requireData(
      service.rpc("reserve_order_stock", {
        target_order_id: order.id,
        reservation_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
      `reserve order ${suffix}`,
    );
  }
  return order;
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
        checkout_id: `TEST-PAGBANK-${runId}-${suffix}`,
        provider_payload: {},
      })
      .select("id,order_id,checkout_id,external_reference,amount,status,last_error")
      .single(),
    `create payment ${suffix}`,
  );
  created.paymentIds.push(payment.id);
  return payment;
}

async function confirm(payment, status, rawStatus = status.toUpperCase()) {
  return requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: status,
      confirmed_method: "test",
      provider_raw_status: rawStatus,
    }),
    `confirm ${status}`,
  );
}

async function orderState(orderId) {
  return requireData(
    service
      .from("orders")
      .select("id,order_number,total,status,payment_status,stock_deducted_at,stock_deduction_error")
      .eq("id", orderId)
      .single(),
    "read order state",
  );
}

async function paymentState(paymentId) {
  return requireData(
    service
      .from("payments")
      .select("id,order_id,checkout_id,external_reference,amount,status,last_error")
      .eq("id", paymentId)
      .single(),
    "read payment state",
  );
}

async function reservationState(orderId) {
  return requireData(
    service
      .from("inventory_reservations")
      .select("id,order_id,variant_id,quantity,status,expires_at,release_reason")
      .eq("order_id", orderId),
    "read reservation state",
  );
}

async function variantStock(variantId) {
  const row = await requireData(
    service.from("product_variants").select("stock").eq("id", variantId).single(),
    "read variant stock",
  );
  return row.stock;
}

async function cleanup() {
  const errors = [];
  async function remove(table, column, values) {
    for (const value of values) {
      const { error } = await service.from(table).delete().eq(column, value);
      if (error) errors.push(`${table}: ${error.code ?? "unknown"} ${error.message}`);
    }
  }

  if (created.orderIds.length) {
    await remove("payment_events", "payment_id", created.paymentIds);
    await remove("order_status_history", "order_id", created.orderIds);
    await remove("shipping_decisions", "order_id", created.orderIds);
    await remove("shipping_quotes", "order_id", created.orderIds);
    await remove("payments", "order_id", created.orderIds);
    await remove("inventory_reservations", "order_id", created.orderIds);
    await remove("order_items", "order_id", created.orderIds);
    await remove("orders", "id", created.orderIds);
  }
  await remove("addresses", "id", created.addressIds);
  await remove("customers", "id", created.customerIds);
  await remove("products", "id", created.productIds);
  await remove(
    "audit_logs",
    "record_id",
    [
      ...created.orderIds,
      ...created.paymentIds,
      ...created.productIds,
      ...created.variantIds,
    ],
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
  const category = await requireData(
    service.from("categories").select("id").eq("slug", "tenis").single(),
    "read category",
  );
  const user = await createUser();
  const catalog = await createCatalog(category.id);
  const context = await createCustomerAndAddress(user);

  const pendingOrder = await createOrder(context, catalog, catalog.variants.PENDING, "PENDING");
  const pendingPayment = await createPayment(pendingOrder, "PENDING");
  await confirm(pendingPayment, "pending", "WAITING");
  const pendingOrderAfter = await orderState(pendingOrder.id);
  const pendingPaymentAfter = await paymentState(pendingPayment.id);
  const pendingReservations = await reservationState(pendingOrder.id);
  pass("pending keeps order awaiting payment", pendingOrderAfter.payment_status === "awaiting_payment");
  pass("pending keeps payment pending", pendingPaymentAfter.status === "pending");
  pass(
    "pending keeps one active reservation",
    pendingReservations.length === 1 && pendingReservations[0].status === "active",
  );
  pass("pending does not decrement stock", await variantStock(catalog.variants.PENDING.id) === 3);

  const analysisOrder = await createOrder(context, catalog, catalog.variants.ANALYSIS, "ANALYSIS");
  const analysisPayment = await createPayment(analysisOrder, "ANALYSIS");
  const analysisBefore = (await reservationState(analysisOrder.id))[0];
  await confirm(analysisPayment, "in_analysis", "IN_ANALYSIS");
  const analysisOrderAfter = await orderState(analysisOrder.id);
  const analysisPaymentAfter = await paymentState(analysisPayment.id);
  const analysisReservations = await reservationState(analysisOrder.id);
  const extendedMinutes =
    (new Date(analysisReservations[0].expires_at).getTime() - Date.now()) / 60_000;
  pass("IN_ANALYSIS is preserved on order", analysisOrderAfter.payment_status === "in_analysis");
  pass("IN_ANALYSIS is preserved on payment", analysisPaymentAfter.status === "in_analysis");
  pass(
    "IN_ANALYSIS extends reservation",
    new Date(analysisReservations[0].expires_at).getTime()
      > new Date(analysisBefore.expires_at).getTime()
      && extendedMinutes > 118
      && extendedMinutes <= 121,
  );
  pass(
    "IN_ANALYSIS does not duplicate reservation",
    analysisReservations.length === 1 && analysisReservations[0].status === "active",
  );
  pass("IN_ANALYSIS does not decrement stock", await variantStock(catalog.variants.ANALYSIS.id) === 3);

  const paidOrder = await createOrder(context, catalog, catalog.variants.PAID, "PAID");
  const paidPayment = await createPayment(paidOrder, "PAID");
  const simultaneousPaid = await Promise.all([
    confirm(paidPayment, "paid", "PAID"),
    confirm(paidPayment, "paid", "PAID"),
  ]);
  pass("two simultaneous confirmations return successfully", simultaneousPaid.length === 2);
  const paidOrderAfter = await orderState(paidOrder.id);
  const paidPaymentAfter = await paymentState(paidPayment.id);
  const paidReservations = await reservationState(paidOrder.id);
  pass(
    "paid updates order and payment",
    paidOrderAfter.status === "paid"
      && paidOrderAfter.payment_status === "paid"
      && paidPaymentAfter.status === "paid",
  );
  pass("paid fills stock_deducted_at", Boolean(paidOrderAfter.stock_deducted_at));
  pass(
    "paid consumes one reservation",
    paidReservations.length === 1
      && paidReservations[0].status === "consumed"
      && paidReservations[0].release_reason === "payment_confirmed",
  );
  pass("paid decrements stock exactly once", await variantStock(catalog.variants.PAID.id) === 0);
  await confirm(paidPayment, "paid", "PAID");
  pass("repeated paid is idempotent", await variantStock(catalog.variants.PAID.id) === 0);

  const eventId = `TEST-PAGBANK-EVENT-${runId}`;
  await requireData(
    service.from("payment_events").insert({
      payment_id: paidPayment.id,
      provider: "pagbank",
      provider_event_id: eventId,
      event_type: "PAID",
      payload: { test: true },
    }),
    "insert first webhook event",
  );
  const duplicateEvent = await service.from("payment_events").insert({
    payment_id: paidPayment.id,
    provider: "pagbank",
    provider_event_id: eventId,
    event_type: "PAID",
    payload: { test: true },
  });
  pass("duplicate webhook event is rejected", duplicateEvent.error?.code === "23505");
  pass("duplicate webhook does not decrement stock", await variantStock(catalog.variants.PAID.id) === 0);

  const divergenceOrder = await createOrder(
    context,
    catalog,
    catalog.variants.DIVERGENCE,
    "DIVERGENCE",
  );
  const divergencePayment = await createPayment(divergenceOrder, "DIVERGENCE");
  const divergenceBefore = {
    order: await orderState(divergenceOrder.id),
    payment: await paymentState(divergencePayment.id),
    reservations: await reservationState(divergenceOrder.id),
    stock: await variantStock(catalog.variants.DIVERGENCE.id),
  };
  pass(
    "divergent webhook reference is rejected before mutation",
    !storedPagBankPaymentMatchesOrder({
      paymentAmount: divergencePayment.amount,
      orderTotal: divergenceOrder.total,
      orderNumber: divergenceOrder.order_number,
      webhookReferenceId: "BSP-DIVERGENT",
    }),
  );
  pass(
    "divergent consulted reference is rejected before mutation",
    !consultedPagBankCheckoutMatchesPayment({
      checkoutId: divergencePayment.checkout_id,
      referenceId: "BSP-DIVERGENT",
      totalCents: 10000,
      expectedCheckoutId: divergencePayment.checkout_id,
      expectedOrderNumber: divergenceOrder.order_number,
      expectedAmount: divergencePayment.amount,
    }),
  );
  pass(
    "divergent consulted amount is rejected before mutation",
    !consultedPagBankCheckoutMatchesPayment({
      checkoutId: divergencePayment.checkout_id,
      referenceId: divergenceOrder.order_number,
      totalCents: 9999,
      expectedCheckoutId: divergencePayment.checkout_id,
      expectedOrderNumber: divergenceOrder.order_number,
      expectedAmount: divergencePayment.amount,
    }),
  );
  const divergenceAfter = {
    order: await orderState(divergenceOrder.id),
    payment: await paymentState(divergencePayment.id),
    reservations: await reservationState(divergenceOrder.id),
    stock: await variantStock(catalog.variants.DIVERGENCE.id),
  };
  pass(
    "divergent reference or amount leaves database unchanged",
    JSON.stringify(divergenceBefore) === JSON.stringify(divergenceAfter),
  );

  const noReservationOrder = await createOrder(
    context,
    catalog,
    catalog.variants.NORESERVATION,
    "NORESERVATION",
    { reserve: false },
  );
  const noReservationPayment = await createPayment(noReservationOrder, "NORESERVATION");
  const missingReservationResult = await confirm(noReservationPayment, "paid", "PAID");
  const noReservationOrderAfter = await orderState(noReservationOrder.id);
  const noReservationPaymentAfter = await paymentState(noReservationPayment.id);
  pass("paid without stock is flagged for administration", Boolean(missingReservationResult[0]?.stock_error));
  pass(
    "paid without stock records deduction errors",
    Boolean(noReservationOrderAfter.stock_deduction_error)
      && Boolean(noReservationPaymentAfter.last_error)
      && !noReservationOrderAfter.stock_deducted_at,
  );
  pass("paid without stock never produces negative stock", await variantStock(catalog.variants.NORESERVATION.id) === 0);

  const terminalCases = [
    ["DECLINED", "declined", "payment_declined"],
    ["CANCELLED", "cancelled", "payment_cancelled"],
    ["EXPIRED", "expired", "payment_expired"],
  ];
  for (const [variantName, status, releaseReason] of terminalCases) {
    const order = await createOrder(context, catalog, catalog.variants[variantName], variantName);
    const payment = await createPayment(order, variantName);
    await confirm(payment, status);
    const orderAfter = await orderState(order.id);
    const paymentAfter = await paymentState(payment.id);
    const reservations = await reservationState(order.id);
    pass(`${status} is preserved on order`, orderAfter.payment_status === status);
    pass(`${status} is preserved on payment`, paymentAfter.status === status);
    pass(
      `${status} releases reservation`,
      reservations.length === 1
        && ["released", "expired"].includes(reservations[0].status)
        && reservations[0].release_reason === releaseReason,
    );
    pass(`${status} does not decrement stock`, await variantStock(catalog.variants[variantName].id) === 1);
  }

  const statusOrder = await createOrder(context, catalog, catalog.variants.STATUSES, "STATUSES");
  for (const status of [
    "awaiting_payment",
    "in_analysis",
    "paid",
    "declined",
    "cancelled",
    "expired",
  ]) {
    const result = await service.from("orders").update({ payment_status: status }).eq("id", statusOrder.id);
    pass(`orders accepts ${status}`, !result.error, result.error?.message);
  }
  const invalidOrderStatus = await service
    .from("orders")
    .update({ payment_status: "invalid_test_status" })
    .eq("id", statusOrder.id);
  pass("orders rejects unknown payment status", Boolean(invalidOrderStatus.error));
  const invalidPaymentStatus = await service
    .from("payments")
    .update({ status: "invalid_test_status" })
    .eq("id", pendingPayment.id);
  pass("payments rejects unknown status", Boolean(invalidPaymentStatus.error));

  const anonFunction = await anon.rpc("confirm_pagbank_payment", {
    target_checkout_id: paidPayment.checkout_id,
    confirmed_status: "paid",
    confirmed_method: "test",
    provider_raw_status: "PAID",
  });
  const authenticatedFunction = await user.authenticated.rpc("confirm_pagbank_payment", {
    target_checkout_id: paidPayment.checkout_id,
    confirmed_status: "paid",
    confirmed_method: "test",
    provider_raw_status: "PAID",
  });
  pass("anon cannot execute payment confirmation", Boolean(anonFunction.error));
  pass("authenticated cannot execute payment confirmation", Boolean(authenticatedFunction.error));

  for (const table of ["customers", "addresses", "orders", "payments", "payment_events"]) {
    const anonRead = await anon.from(table).select("id").limit(1);
    pass(`anon cannot read ${table}`, Boolean(anonRead.error));
  }
  const anonReservations = await anon.from("inventory_reservations").select("id").limit(1);
  const authenticatedReservations = await user.authenticated
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  pass("anon cannot read inventory_reservations", Boolean(anonReservations.error));
  pass(
    "authenticated cannot read inventory_reservations",
    Boolean(authenticatedReservations.error),
  );
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = await cleanup();
  const after = await counts();
  const result = {
    runId,
    projectHost: EXPECTED_PROJECT_HOST,
    checksPassed: checks.length,
    checks,
    cleanupErrors,
    countsBefore: before,
    countsAfter: after,
    countsPreserved: JSON.stringify(before) === JSON.stringify(after),
    failure: failure ? { name: failure.name, message: failure.message } : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failure || cleanupErrors.length || !result.countsPreserved) process.exitCode = 1;
}
