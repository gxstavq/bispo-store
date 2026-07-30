import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const host = "jpyqsaxyrbsdmfylayax.supabase.co";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey || new URL(url).host !== host) {
  throw new Error("Teste recusado fora da homologação.");
}
if (process.env.ALLOW_HOMOLOGATION_TEST_WRITES !== "true") {
  throw new Error("Teste remoto não autorizado.");
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
let userId;
let productId;
let variantId;
let order;

try {
  const email = `bispo-legacy-${runId}@example.com`;
  const password = `T3st!${randomBytes(18).toString("base64url")}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const category = await service.from("categories").select("id").eq("slug", "tenis").single();
  if (category.error) throw category.error;
  const product = await service.from("products").insert({
    category_id: category.data.id,
    name: `[TESTE RPC LEGACY] ${runId}`,
    slug: `teste-rpc-legacy-${runId}`,
    code: `TEST-LEGACY-${runId}`,
    description: "Registro sintético descartável.",
    price: 100,
    weight_kg: 1.25,
    length_cm: 33,
    width_cm: 20,
    height_cm: 12,
    packaging_category: "caixa-tenis",
    shipping_enabled: true,
    status: "active",
    needs_review: false,
  }).select("id").single();
  if (product.error) throw product.error;
  productId = product.data.id;
  const variant = await service.from("product_variants").insert({
    product_id: productId,
    sku: `TEST-LEGACY-${runId}-40`,
    size: "40",
    color: "Preto",
    stock: 1,
    active: true,
  }).select("id").single();
  if (variant.error) throw variant.error;
  variantId = variant.data.id;
  const response = await client.rpc("create_customer_order", {
    customer_data: {
      full_name: `[TESTE RPC LEGACY] ${runId}`,
      whatsapp: "5511999999999",
      email,
    },
    address_data: {
      postal_code: "03870-100",
      street: "Avenida São Miguel",
      number: "5046",
      complement: "TESTE",
      district: "Ponte Rasa",
      city: "São Paulo",
      state: "SP",
      reference: "Teste descartável",
    },
    cart_items: [{ product_id: productId, size: "40", color: "Preto", quantity: 1 }],
    requested_delivery_choice: "local_delivery_review",
    order_notes: `[TESTE RPC LEGACY] ${runId}`,
    selected_shipping_quote_id: null,
  });
  if (response.error) throw response.error;
  const number = response.data?.[0]?.order_number;
  const found = await service.from("orders")
    .select("id,customer_id,address_id")
    .eq("order_number", number)
    .single();
  if (found.error) throw found.error;
  order = found.data;
  const reservation = await service.from("inventory_reservations")
    .select("id,status,quantity")
    .eq("order_id", order.id)
    .single();
  if (reservation.error) throw reservation.error;
  console.log(JSON.stringify({
    legacyRpcSucceeded: true,
    reservationCreatedAtomically: reservation.data.status === "active"
      && reservation.data.quantity === 1,
  }));
} finally {
  if (order) {
    await service.from("order_status_history").delete().eq("order_id", order.id);
    await service.from("inventory_reservations").delete().eq("order_id", order.id);
    await service.from("orders").delete().eq("id", order.id);
    await service.from("addresses").delete().eq("id", order.address_id);
    await service.from("customers").delete().eq("id", order.customer_id);
  }
  if (productId) await service.from("products").delete().eq("id", productId);
  const auditIds = [order?.id, productId, variantId].filter(Boolean);
  for (const id of auditIds) await service.from("audit_logs").delete().eq("record_id", id);
  if (userId) await service.auth.admin.deleteUser(userId);
}
