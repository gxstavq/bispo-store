import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const previewOrigin = "https://deploy-preview-1--bispo-store-homologacao.netlify.app";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL ausente.");
assert.ok(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY ausente.");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY ausente.");

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const marker = `TESTE-SANDBOX-PAGBANK-${runId}`;
const email = `pagbank-sandbox-${runId}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const orderIdempotencyKey = randomUUID();

const created = {
  authUserId: null,
  productId: null,
  variantId: null,
  orderDatabaseId: null,
  orderNumber: null,
  checkoutId: null,
};

let checkoutPersisted = false;

function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (!result.data) throw new Error(`${label}: resposta sem dados.`);
  return result.data;
}

async function requestJson(path, { method = "GET", cookieHeader, body, headers = {} } = {}) {
  const response = await fetch(new URL(path, previewOrigin), {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      Origin: previewOrigin,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Resposta HTTP inesperada.";
    throw new Error(`${path}: HTTP ${response.status}: ${message}`);
  }
  return { status: response.status, payload };
}

async function cleanupBeforeCheckout() {
  if (created.orderDatabaseId) {
    await service.from("orders").delete().eq("id", created.orderDatabaseId);
  }
  if (created.authUserId) {
    await service.from("shipping_quotes").delete().eq("customer_user_id", created.authUserId);
  }
  if (created.productId) {
    await service.from("products").delete().eq("id", created.productId);
  }
  if (created.authUserId) {
    await service.from("audit_logs")
      .update({ actor_user_id: null })
      .eq("actor_user_id", created.authUserId);
    await service.auth.admin.deleteUser(created.authUserId);
  }
}

try {
  const category = requireData(
    await service.from("categories").select("id").eq("slug", "tenis").single(),
    "categoria de teste",
  );

  const authUser = requireData(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: marker,
        synthetic_test: true,
        environment: "sandbox",
      },
      app_metadata: {
        synthetic_test: true,
        environment: "sandbox",
      },
    }),
    "usuário Auth sintético",
  ).user;
  assert.ok(authUser?.id, "Usuário Auth sintético não foi criado.");
  created.authUserId = authUser.id;

  const product = requireData(
    await service.from("products").insert({
      legacy_id: marker,
      category_id: category.id,
      name: `[TESTE SANDBOX] Tênis PagBank ${runId}`,
      slug: `teste-sandbox-pagbank-${runId}`,
      code: `TST-PB-${runId}`,
      description: `${marker} — registro sintético; não vender.`,
      price: 199.9,
      promotional_price: null,
      weight_kg: 1.25,
      length_cm: 33,
      width_cm: 20,
      height_cm: 12,
      packaging_category: "caixa-tenis",
      shipping_enabled: true,
      featured: false,
      is_new: false,
      status: "active",
      needs_review: true,
      published_at: new Date().toISOString(),
    }).select("id, price").single(),
    "produto sintético",
  );
  created.productId = product.id;

  const variant = requireData(
    await service.from("product_variants").insert({
      product_id: product.id,
      sku: `TST-PB-${runId}-U`,
      size: "TESTE",
      color: "SANDBOX",
      stock: 2,
      active: true,
    }).select("id").single(),
    "variante sintética",
  );
  created.variantId = variant.id;

  const cookies = new Map();
  const authClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return [...cookies].map(([name, value]) => ({ name, value }));
      },
      setAll(values) {
        for (const { name, value } of values) cookies.set(name, value);
      },
    },
  });
  const session = requireData(
    await authClient.auth.signInWithPassword({ email, password }),
    "sessão sintética",
  );
  assert.equal(session.user.id, created.authUserId, "Sessão pertence a outro usuário.");
  const cookieHeader = [...cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  assert.ok(cookieHeader, "Cookie autenticado não foi criado.");

  const cart = [{
    productId: created.productId,
    size: "TESTE",
    color: "SANDBOX",
    quantity: 1,
  }];

  const quoteResponse = await requestJson("/api/shipping/quotes", {
    method: "POST",
    cookieHeader,
    body: {
      postalCode: "01310100",
      items: cart,
    },
  });
  assert.ok(Array.isArray(quoteResponse.payload.quotes), "Cotação sem lista de serviços.");
  assert.ok(quoteResponse.payload.quotes.length > 0, "Nenhuma opção de frete retornada.");
  const selectedQuote = [...quoteResponse.payload.quotes]
    .sort((a, b) => Number(a.amount) - Number(b.amount))[0];
  assert.ok(selectedQuote?.id, "Cotação selecionada sem identificador.");
  assert.ok(Number(selectedQuote.amount) >= 0, "Frete inválido.");

  const checkoutBody = {
    items: cart,
    customer: {
      fullName: `[TESTE SANDBOX] Cliente PagBank ${runId}`,
      whatsapp: "11999999999",
      email,
      cep: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      complement: "TESTE SANDBOX — NÃO ENTREGAR",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      reference: marker,
      notes: `${marker} — pedido sintético; não separar nem enviar.`,
      deliveryChoice: "shipping_quote",
      selectedShippingQuoteId: selectedQuote.id,
    },
  };

  const orderResponse = await requestJson("/api/orders", {
    method: "POST",
    cookieHeader,
    headers: { "Idempotency-Key": orderIdempotencyKey },
    body: checkoutBody,
  });
  assert.equal(orderResponse.status, 201, "Pedido sintético não retornou HTTP 201.");
  created.orderNumber = orderResponse.payload.id;
  assert.match(created.orderNumber, /^BSP-[A-F0-9]{8}$/);

  const repeatedOrderResponse = await requestJson("/api/orders", {
    method: "POST",
    cookieHeader,
    headers: { "Idempotency-Key": orderIdempotencyKey },
    body: checkoutBody,
  });
  assert.equal(repeatedOrderResponse.payload.id, created.orderNumber);

  const orders = requireData(
    await service
      .from("orders")
      .select("id, order_number, subtotal, shipping_amount, total, idempotency_key, selected_shipping_quote_id")
      .eq("idempotency_key", orderIdempotencyKey),
    "pedido persistido",
  );
  assert.equal(orders.length, 1, "A mesma chave criou mais de um pedido.");
  const order = orders[0];
  created.orderDatabaseId = order.id;
  assert.equal(order.order_number, created.orderNumber);
  assert.equal(order.selected_shipping_quote_id, selectedQuote.id);

  const paymentResponse = await requestJson(
    `/api/orders/${encodeURIComponent(created.orderNumber)}/payment-checkout`,
    { method: "POST", cookieHeader },
  );
  assert.equal(paymentResponse.status, 200, "Checkout não retornou HTTP 200.");
  assert.ok(paymentResponse.payload.checkoutId, "Checkout PagBank sem ID.");
  assert.match(paymentResponse.payload.paymentUrl, /^https:\/\//);
  created.checkoutId = paymentResponse.payload.checkoutId;
  checkoutPersisted = true;

  const repeatedPaymentResponse = await requestJson(
    `/api/orders/${encodeURIComponent(created.orderNumber)}/payment-checkout`,
    { method: "POST", cookieHeader },
  );
  assert.equal(repeatedPaymentResponse.payload.checkoutId, created.checkoutId);
  assert.equal(repeatedPaymentResponse.payload.paymentUrl, paymentResponse.payload.paymentUrl);
  assert.equal(repeatedPaymentResponse.payload.reused, true);

  const payments = requireData(
    await service
      .from("payments")
      .select("checkout_id, payment_url, amount, status, idempotency_key, provider_payload")
      .eq("order_id", order.id)
      .eq("provider", "pagbank"),
    "pagamento persistido",
  );
  assert.equal(payments.length, 1, "A repetição criou mais de um checkout local.");
  const payment = payments[0];
  assert.equal(payment.checkout_id, created.checkoutId);
  assert.equal(payment.payment_url, paymentResponse.payload.paymentUrl);
  assert.equal(payment.status, "pending");
  assert.equal(payment.provider_payload?.id, created.checkoutId);
  assert.equal(payment.provider_payload?.reference_id, created.orderNumber);

  const subtotal = Number(order.subtotal);
  const shipping = Number(order.shipping_amount);
  const total = Number(order.total);
  assert.equal(subtotal, 199.9);
  assert.equal(shipping, Number(selectedQuote.amount));
  assert.equal(Math.round(total * 100), Math.round((subtotal + shipping) * 100));
  assert.equal(Math.round(Number(payment.amount) * 100), Math.round(total * 100));

  const providerItems = Array.isArray(payment.provider_payload?.items)
    ? payment.provider_payload.items
    : [];
  const providerItemsCents = providerItems.reduce(
    (sum, item) => sum + Number(item.unit_amount ?? 0) * Number(item.quantity ?? 0),
    0,
  );
  const providerShippingCents = Number(payment.provider_payload?.shipping?.amount ?? 0);
  if (providerItems.length) {
    assert.equal(providerItemsCents + providerShippingCents, Math.round(total * 100));
  }

  const expectedNotificationUrl = `${previewOrigin}/api/webhooks/pagbank`;
  const expectedRedirectUrl =
    `${previewOrigin}/pedido-recebido?pedido=${encodeURIComponent(created.orderNumber)}`;
  const providerLinks = Array.isArray(payment.provider_payload?.links)
    ? payment.provider_payload.links
    : [];
  const payLink = providerLinks.find((link) => link?.rel === "PAY")?.href;
  assert.equal(payLink, payment.payment_url);

  console.log(JSON.stringify({
    result: "ok",
    environment: "sandbox",
    marker,
    upstreamAccepted: true,
    applicationPaymentEndpointHttpStatus: paymentResponse.status,
    order: {
      number: created.orderNumber,
      idempotencyKey: orderIdempotencyKey,
      countForIdempotencyKey: orders.length,
      subtotal,
      shipping,
      total,
      totalCents: Math.round(total * 100),
    },
    quote: {
      optionsReturned: quoteResponse.payload.quotes.length,
      selected: {
        carrier: selectedQuote.carrier,
        service: selectedQuote.service,
        amount: Number(selectedQuote.amount),
        deliveryDays: selectedQuote.deliveryDays,
      },
    },
    checkout: {
      id: created.checkoutId,
      referenceId: payment.provider_payload.reference_id,
      paymentUrl: payment.payment_url,
      status: payment.status,
      reusedOnSecondCall: repeatedPaymentResponse.payload.reused,
      localCheckoutCount: payments.length,
      expectedNotificationUrl,
      expectedRedirectUrl,
      providerItemCents: providerItemsCents || null,
      providerShippingCents: providerShippingCents || null,
      providerPaymentMethods: payment.provider_payload?.payment_methods ?? null,
    },
  }, null, 2));
} catch (error) {
  if (!checkoutPersisted) await cleanupBeforeCheckout();
  console.error(JSON.stringify({
    result: "error",
    marker,
    retainedForSafety: checkoutPersisted,
    orderNumber: created.orderNumber,
    checkoutId: created.checkoutId,
    message: error instanceof Error ? error.message : "Falha desconhecida.",
  }, null, 2));
  process.exitCode = 1;
}
