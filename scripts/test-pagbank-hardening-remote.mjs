import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_PROJECT_HOST = "jpyqsaxyrbsdmfylayax.supabase.co";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("As variáveis do Supabase são obrigatórias.");
}
if (new URL(supabaseUrl).host !== EXPECTED_PROJECT_HOST) {
  throw new Error("Teste remoto recusado: o projeto não é a homologação autorizada.");
}
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("Defina ALLOW_HOMOLOGATION_TEST_WRITES=true somente para a homologação.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const createdUserIds = [];
const createdOrderIds = [];
const createdCustomerIds = [];
const createdAddressIds = [];
const createdPaymentIds = [];
const createdProductIds = [];
const createdVariantIds = [];
const checks = [];

function record(name, condition, details) {
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  checks.push(name);
}

async function requireData(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function createTestUser(index) {
  const email = `bispo-security-${runId}-${index}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const created = await requireData(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
    "create auth test user",
  );
  createdUserIds.push(created.user.id);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const session = await requireData(
    client.auth.signInWithPassword({ email, password }),
    "sign in auth test user",
  );
  assert.equal(session.user.id, created.user.id);
  return { client, userId: created.user.id };
}

function customerPayload(index) {
  return {
    full_name: `Cliente de teste ${index}`,
    whatsapp: "5511999999999",
    email: `bispo-security-${runId}-${index}@example.com`,
  };
}

const addressPayload = {
  postal_code: "03870-100",
  street: "Avenida São Miguel",
  number: "5046",
  complement: "",
  district: "Ponte Rasa",
  city: "São Paulo",
  state: "SP",
  reference: "Teste automatizado de homologação",
};

function cartPayload(productId, size, color, quantity = 1) {
  return [{ product_id: productId, size, color, quantity }];
}

async function createOrder(client, {
  index,
  productId,
  size,
  color,
  idempotencyKey = randomUUID(),
  notes = "Teste remoto descartável",
  legacy = false,
}) {
  const args = {
    customer_data: customerPayload(index),
    address_data: addressPayload,
    cart_items: cartPayload(productId, size, color),
    requested_delivery_choice: "local_delivery_review",
    order_notes: notes,
    selected_shipping_quote_id: null,
  };
  if (!legacy) args.requested_idempotency_key = idempotencyKey;
  const rows = await requireData(client.rpc("create_customer_order", args), "create test order");
  const orderNumber = rows?.[0]?.order_number;
  assert.ok(orderNumber);
  const order = await requireData(
    service
      .from("orders")
      .select("id,order_number,customer_id,address_id,total,payment_status,status")
      .eq("order_number", orderNumber)
      .single(),
    "read created order",
  );
  if (!createdOrderIds.includes(order.id)) createdOrderIds.push(order.id);
  if (!createdCustomerIds.includes(order.customer_id)) createdCustomerIds.push(order.customer_id);
  if (!createdAddressIds.includes(order.address_id)) createdAddressIds.push(order.address_id);
  return order;
}

async function createPayment(order, suffix) {
  const row = await requireData(
    service
      .from("payments")
      .insert({
        order_id: order.id,
        provider: "pagbank",
        external_reference: order.order_number,
        amount: order.total,
        status: "pending",
        checkout_id: `TEST-${runId}-${suffix}`,
        provider_payload: {},
      })
      .select("id,checkout_id")
      .single(),
    "create test payment",
  );
  createdPaymentIds.push(row.id);
  return row;
}

async function createProduct(categoryId, suffix, stock) {
  const product = await requireData(
    service
      .from("products")
      .insert({
        category_id: categoryId,
        name: `Produto teste concorrência ${suffix}`,
        slug: `teste-concorrencia-${runId}-${suffix}`,
        code: `TST-${runId}-${suffix}`,
        description: "Registro descartável de teste em homologação.",
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
    "create test product",
  );
  createdProductIds.push(product.id);
  const variant = await requireData(
    service
      .from("product_variants")
      .insert({
        product_id: product.id,
        sku: `TST-${runId}-${suffix}-40-PRETO`,
        size: "40",
        color: "Preto",
        stock,
        active: true,
      })
      .select("id,stock")
      .single(),
    "create test variant",
  );
  createdVariantIds.push(variant.id);
  return { productId: product.id, variantId: variant.id };
}

async function reserve(orderId, minutes = 120) {
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const rows = await requireData(
    service.rpc("reserve_order_stock", {
      target_order_id: orderId,
      reservation_expires_at: expiresAt,
    }),
    "reserve order stock",
  );
  return rows?.[0];
}

async function cleanup() {
  if (createdOrderIds.length) {
    await service.from("order_status_history").delete().in("order_id", createdOrderIds);
    await service.from("shipping_decisions").delete().in("order_id", createdOrderIds);
    await service.from("shipping_quotes").delete().in("order_id", createdOrderIds);
    await service.from("payments").delete().in("order_id", createdOrderIds);
    await service.from("inventory_reservations").delete().in("order_id", createdOrderIds);
    await service.from("orders").delete().in("id", createdOrderIds);
    await service.from("audit_logs").delete().in("record_id", [
      ...createdOrderIds,
      ...createdPaymentIds,
    ]);
  }
  if (createdAddressIds.length) {
    await service.from("addresses").delete().in("id", createdAddressIds);
  }
  if (createdCustomerIds.length) {
    await service.from("customers").delete().in("id", createdCustomerIds);
  }
  if (createdProductIds.length || createdVariantIds.length) {
    await service.from("audit_logs").delete().in("record_id", [
      ...createdProductIds,
      ...createdVariantIds,
    ]);
  }
  if (createdProductIds.length) {
    await service.from("products").delete().in("id", createdProductIds);
  }
  for (const userId of createdUserIds) {
    await service.auth.admin.deleteUser(userId);
  }
}

let failure;
try {
  const beforeOrders = await requireData(
    service.from("orders").select("id,order_number").limit(1),
    "read pre-existing order",
  );
  const preExistingOrder = beforeOrders[0] ?? null;

  const category = await requireData(
    service.from("categories").select("id").eq("slug", "tenis").single(),
    "read category",
  );
  const idempotencyProduct = await createProduct(category.id, "idem", 50);
  const raceProduct = await createProduct(category.id, "race", 1);
  const releaseProduct = await createProduct(category.id, "release", 5);

  const idempotencyUser = await createTestUser(1);
  const idempotencyKey = randomUUID();
  const firstOrder = await createOrder(idempotencyUser.client, {
    index: 1,
    productId: idempotencyProduct.productId,
    size: "40",
    color: "Preto",
    idempotencyKey,
  });
  const repeatedOrder = await createOrder(idempotencyUser.client, {
    index: 1,
    productId: idempotencyProduct.productId,
    size: "40",
    color: "Preto",
    idempotencyKey,
  });
  record("same idempotency key returns the same order", firstOrder.id === repeatedOrder.id);

  const simultaneous = await Promise.all(
    Array.from({ length: 20 }, () =>
      createOrder(idempotencyUser.client, {
        index: 1,
        productId: idempotencyProduct.productId,
        size: "40",
        color: "Preto",
        idempotencyKey,
      })),
  );
  record(
    "20 simultaneous retries return one order",
    simultaneous.every((order) => order.id === firstOrder.id),
  );

  const differentPayload = await idempotencyUser.client.rpc("create_customer_order", {
    customer_data: customerPayload(1),
    address_data: addressPayload,
    cart_items: cartPayload(idempotencyProduct.productId, "40", "Preto"),
    requested_delivery_choice: "local_delivery_review",
    order_notes: "Payload propositalmente diferente",
    selected_shipping_quote_id: null,
    requested_idempotency_key: idempotencyKey,
  });
  record(
    "same key with different payload is rejected",
    Boolean(differentPayload.error?.message.includes("idempotency_key_reused_with_different_payload")),
  );

  const idempotencyRows = await requireData(
    service.from("orders").select("id").eq("idempotency_key", idempotencyKey),
    "count idempotent orders",
  );
  record("idempotency unique constraint persisted one row", idempotencyRows.length === 1);

  const legacyOrder = await createOrder(idempotencyUser.client, {
    index: 1,
    productId: idempotencyProduct.productId,
    size: "40",
    color: "Preto",
    legacy: true,
  });
  record("legacy six-argument RPC remains functional", Boolean(legacyOrder.id));

  const raceUserA = await createTestUser(2);
  const raceUserB = await createTestUser(3);
  const raceOrderA = await createOrder(raceUserA.client, {
    index: 2,
    productId: raceProduct.productId,
    size: "40",
    color: "Preto",
  });
  const raceOrderB = await createOrder(raceUserB.client, {
    index: 3,
    productId: raceProduct.productId,
    size: "40",
    color: "Preto",
  });
  const raceResults = await Promise.allSettled([
    reserve(raceOrderA.id),
    reserve(raceOrderB.id),
  ]);
  const successfulRaceIndexes = raceResults
    .map((result, index) => result.status === "fulfilled" ? index : -1)
    .filter((index) => index >= 0);
  record("different keys racing for last unit produce one winner", successfulRaceIndexes.length === 1);
  const winningOrder = successfulRaceIndexes[0] === 0 ? raceOrderA : raceOrderB;

  const activeReservation = await requireData(
    service
      .from("inventory_reservations")
      .select("id,expires_at,status,quantity")
      .eq("order_id", winningOrder.id)
      .single(),
    "read winning reservation",
  );
  const remainingMinutes = (new Date(activeReservation.expires_at).getTime() - Date.now()) / 60_000;
  record("reservation is created for 120 minutes", remainingMinutes > 118 && remainingMinutes <= 121);

  const payment = await createPayment(winningOrder, "winner");
  const beforeAnalysisExpiry = new Date(activeReservation.expires_at).getTime();
  await delay(20);
  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "in_analysis",
      confirmed_method: "credit_card",
      provider_raw_status: "IN_ANALYSIS",
    }),
    "confirm in analysis",
  );
  const analysisReservation = await requireData(
    service
      .from("inventory_reservations")
      .select("expires_at,status")
      .eq("order_id", winningOrder.id)
      .single(),
    "read extended reservation",
  );
  record(
    "IN_ANALYSIS extends the reservation",
    new Date(analysisReservation.expires_at).getTime() > beforeAnalysisExpiry,
  );

  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "credit_card",
      provider_raw_status: "PAID",
    }),
    "confirm paid",
  );
  const stockAfterFirstPayment = await requireData(
    service.from("product_variants").select("stock").eq("id", raceProduct.variantId).single(),
    "read stock after payment",
  );
  await requireData(
    service.rpc("confirm_pagbank_payment", {
      target_checkout_id: payment.checkout_id,
      confirmed_status: "paid",
      confirmed_method: "credit_card",
      provider_raw_status: "PAID",
    }),
    "repeat paid webhook",
  );
  const stockAfterRepeatedPayment = await requireData(
    service.from("product_variants").select("stock").eq("id", raceProduct.variantId).single(),
    "read stock after repeated payment",
  );
  record("payment consumes reservation and decrements stock once", stockAfterFirstPayment.stock === 0);
  record("repeated webhook does not decrement stock again", stockAfterRepeatedPayment.stock === 0);
  record("stock never becomes negative", stockAfterRepeatedPayment.stock >= 0);

  const terminalStatuses = [
    ["declined", "payment_declined"],
    ["cancelled", "payment_cancelled"],
    ["expired", "payment_expired"],
  ];
  for (let index = 0; index < terminalStatuses.length; index += 1) {
    const [paymentStatus, reason] = terminalStatuses[index];
    const user = await createTestUser(4 + index);
    const order = await createOrder(user.client, {
      index: 4 + index,
      productId: releaseProduct.productId,
      size: "40",
      color: "Preto",
    });
    await reserve(order.id);
    const terminalPayment = await createPayment(order, paymentStatus);
    if (paymentStatus === "expired") {
      await requireData(
        service
          .from("inventory_reservations")
          .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
          .eq("order_id", order.id),
        "age test reservation",
      );
    }
    await requireData(
      service.rpc("confirm_pagbank_payment", {
        target_checkout_id: terminalPayment.checkout_id,
        confirmed_status: paymentStatus,
        confirmed_method: "test",
        provider_raw_status: paymentStatus.toUpperCase(),
      }),
      `confirm ${paymentStatus}`,
    );
    const reservation = await requireData(
      service
        .from("inventory_reservations")
        .select("status,release_reason")
        .eq("order_id", order.id)
        .single(),
      `read ${paymentStatus} reservation`,
    );
    record(
      `${paymentStatus} releases its reservation`,
      ["released", "expired"].includes(reservation.status) && reservation.release_reason === reason,
    );
  }

  const allowedPaymentStatuses = [
    "awaiting_payment",
    "in_analysis",
    "paid",
    "declined",
    "cancelled",
    "expired",
  ];
  for (const status of allowedPaymentStatuses) {
    const result = await service
      .from("orders")
      .update({ payment_status: status })
      .eq("id", legacyOrder.id);
    record(`orders constraint accepts ${status}`, !result.error, result.error?.message);
  }
  const invalidOrderStatus = await service
    .from("orders")
    .update({ payment_status: "invalid_test_status" })
    .eq("id", legacyOrder.id);
  record("orders constraint rejects unknown payment status", Boolean(invalidOrderStatus.error));

  const allowedProviderStatuses = [
    "pending",
    "in_analysis",
    "paid",
    "declined",
    "cancelled",
    "expired",
  ];
  for (const status of allowedProviderStatuses) {
    const result = await service
      .from("payments")
      .update({ status })
      .eq("id", payment.id);
    record(`payments constraint accepts ${status}`, !result.error, result.error?.message);
  }
  const invalidPaymentStatus = await service
    .from("payments")
    .update({ status: "invalid_test_status" })
    .eq("id", payment.id);
  record("payments constraint rejects unknown status", Boolean(invalidPaymentStatus.error));

  const anonReservations = await anon.from("inventory_reservations").select("id").limit(1);
  record("anon cannot access inventory reservations", Boolean(anonReservations.error));
  const authReservations = await idempotencyUser.client
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  record("authenticated cannot access inventory reservations", Boolean(authReservations.error));
  const serviceReservations = await service
    .from("inventory_reservations")
    .select("id")
    .limit(1);
  record("service role can access inventory reservations", !serviceReservations.error);

  if (preExistingOrder) {
    const preservedOrder = await requireData(
      service
        .from("orders")
        .select("id,order_number")
        .eq("id", preExistingOrder.id)
        .single(),
      "re-read pre-existing order",
    );
    record(
      "pre-existing order remains accessible",
      preservedOrder.order_number === preExistingOrder.order_number,
    );
  } else {
    checks.push("no pre-existing order existed to re-read");
  }
} catch (error) {
  failure = error;
} finally {
  await cleanup();
}

if (failure) throw failure;
console.log(JSON.stringify({ projectHost: EXPECTED_PROJECT_HOST, checksPassed: checks.length, checks }, null, 2));
