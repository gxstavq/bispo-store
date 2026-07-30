import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const baseUrl = new URL(
  process.env.TEST_BASE_URL
    ?? "https://deploy-preview-1--bispo-store-homologacao.netlify.app",
);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
assert.ok(supabaseUrl && anonKey && serviceRoleKey, "Supabase não configurado.");

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const marker = `TESTE-CHECKOUT-ANONIMO-${runId}`;
let productId;
let guestUserId;

function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (!result.data) throw new Error(`${label}: resposta sem dados.`);
  return result.data;
}

function collectCookies(response, jar) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function cleanup() {
  if (guestUserId) {
    await service.from("shipping_quotes").delete().eq("customer_user_id", guestUserId);
    await service.from("audit_logs")
      .update({ actor_user_id: null })
      .eq("actor_user_id", guestUserId);
  }
  if (productId) await service.from("products").delete().eq("id", productId);
  if (guestUserId) await service.auth.admin.deleteUser(guestUserId);
}

try {
  const category = required(
    await service.from("categories").select("id").eq("slug", "tenis").single(),
    "categoria",
  );
  const product = required(
    await service.from("products").insert({
      legacy_id: marker,
      category_id: category.id,
      name: `[TESTE] Checkout anônimo ${runId}`,
      slug: `teste-checkout-anonimo-${runId}`,
      code: `TST-ANON-${runId}`,
      description: `${marker} — não vender.`,
      price: 199.9,
      weight_kg: 1.25,
      length_cm: 33,
      width_cm: 20,
      height_cm: 12,
      packaging_category: "caixa-tenis",
      shipping_enabled: true,
      status: "active",
      needs_review: true,
    }).select("id").single(),
    "produto",
  );
  productId = product.id;
  await required(
    await service.from("product_variants").insert({
      product_id: productId,
      sku: `TST-ANON-${runId}-U`,
      size: "TESTE",
      color: "SANDBOX",
      stock: 2,
      active: true,
    }).select("id").single(),
    "variante",
  );

  const addressResponse = await fetch(
    new URL("/api/address/cep?postalCode=01310100", baseUrl),
    { redirect: "manual" },
  );
  const address = await addressResponse.json();
  assert.equal(addressResponse.status, 200);
  assert.equal(address.street, "Avenida Paulista");
  assert.equal(address.district, "Bela Vista");
  assert.equal(address.city, "São Paulo");
  assert.equal(address.state, "SP");

  const jar = new Map();
  const shippingResponse = await fetch(new URL("/api/shipping/quotes", baseUrl), {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: baseUrl.origin,
    },
    body: JSON.stringify({
      postalCode: "01310100",
      items: [{
        productId,
        size: "TESTE",
        color: "SANDBOX",
        quantity: 1,
      }],
    }),
  });
  collectCookies(shippingResponse, jar);
  const shipping = await shippingResponse.json();
  if (cookieHeader(jar)) {
    const sessionClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: () => {},
      },
    });
    const { data: { user }, error: sessionError } = await sessionClient.auth.getUser();
    assert.ifError(sessionError);
    assert.ok(user?.id, "A sessão temporária não possui usuário.");
    assert.equal(user.app_metadata?.guest_checkout, true);
    guestUserId = user.id;
  }
  assert.equal(shippingResponse.status, 200, shipping.error);
  assert.ok(Array.isArray(shipping.quotes) && shipping.quotes.length > 0);
  assert.ok(cookieHeader(jar), "A sessão do checkout não foi preservada em cookie.");

  const customerRows = required(
    await service.from("customers").select("id").eq("user_id", guestUserId),
    "clientes da sessão",
  );
  const orderRows = customerRows.length
    ? required(
      await service.from("orders").select("id").in(
        "customer_id",
        customerRows.map((customer) => customer.id),
      ),
      "pedidos da sessão",
    )
    : [];
  const paymentRows = orderRows.length
    ? required(
      await service.from("payments").select("id").in(
        "order_id",
        orderRows.map((order) => order.id),
      ),
      "pagamentos da sessão",
    )
    : [];
  assert.equal(customerRows.length, 0);
  assert.equal(orderRows.length, 0);
  assert.equal(paymentRows.length, 0);

  const selected = [...shipping.quotes].sort((a, b) => Number(a.amount) - Number(b.amount))[0];
  console.log(JSON.stringify({
    result: "ok",
    baseUrl: baseUrl.origin,
    address,
    quotesReturned: shipping.quotes.length,
    selectedQuote: {
      carrier: selected.carrier,
      service: selected.service,
      amount: Number(selected.amount),
      deliveryDays: selected.deliveryDays,
    },
    subtotal: 199.9,
    totalWithSelectedShipping: 199.9 + Number(selected.amount),
    stayedInCheckout: true,
    customersCreated: customerRows.length,
    ordersCreated: orderRows.length,
    paymentsCreated: paymentRows.length,
  }, null, 2));
} finally {
  await cleanup();
}
