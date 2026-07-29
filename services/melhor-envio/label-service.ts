import "server-only";

import { createHash } from "node:crypto";
import {
  assertMelhorEnvioLabelPurchaseEnabled,
} from "@/lib/integrations/config";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { melhorEnvioRequest } from "@/services/melhor-envio/client";
import { recordIntegrationError } from "@/services/integration-errors";

type MelhorEnvioCartResponse = { id?: string; order?: { id?: string } };
type MelhorEnvioPrintResponse = { url?: string };

function requiredFiscal(value: string | null | undefined, label: string) {
  if (!value?.trim()) throw new Error(`${label} é obrigatório para compra comercial de etiquetas.`);
  return value.trim();
}

function addressParts(value: string) {
  const [street, number] = value.split(",").map((part) => part.trim());
  return { street: requiredFiscal(street, "Rua de origem"), number: requiredFiscal(number, "Número de origem") };
}

export async function purchaseMelhorEnvioLabel(orderNumber: string, actorId: string, invoiceKeyInput: string) {
  assertMelhorEnvioLabelPurchaseEnabled();
  const cnpj = requiredFiscal(process.env.STORE_CNPJ, "CNPJ").replace(/\D/g, "");
  const invoiceKey = invoiceKeyInput.replace(/\D/g, "");
  if (invoiceKey.length !== 44) throw new Error("Informe uma chave de nota fiscal válida com 44 dígitos.");

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.from("orders").select(`
    id, order_number, status, invoice_key, selected_shipping_quote_id,
    customers!inner(full_name, whatsapp, email),
    addresses!inner(postal_code, street, number, complement, district, city, state),
    order_items!inner(quantity, unit_price, product_snapshot, products!inner(weight_kg, length_cm, width_cm, height_cm)),
    selected_quote:shipping_quotes!orders_selected_shipping_quote_id_fkey(service_id, carrier_name, service_name)
  `).eq("order_number", orderNumber).single();
  if (error || !data) throw new Error(error?.message ?? "Pedido não encontrado.");

  const { data: settings, error: settingsError } = await supabase.from("store_settings")
    .select("store_name, origin_address, origin_postal_code, commercial_email, state_registration, origin_district, origin_city, origin_state, sender_phone")
    .eq("singleton", true).single();
  if (settingsError || !settings) throw new Error(settingsError?.message ?? "Configurações da loja ausentes.");
  requiredFiscal(settings.state_registration, "Inscrição estadual");
  const origin = addressParts(settings.origin_address);
  const customer = Array.isArray(data.customers) ? data.customers[0] : data.customers;
  const address = Array.isArray(data.addresses) ? data.addresses[0] : data.addresses;
  const quote = Array.isArray(data.selected_quote) ? data.selected_quote[0] : data.selected_quote;
  if (!quote?.service_id) throw new Error("O pedido não possui serviço Melhor Envio selecionado.");
  if (data.status !== "paid") throw new Error("A etiqueta só pode ser comprada para um pedido pago.");

  const idempotencyKey = createHash("sha256")
    .update(`melhor-envio:sandbox:label:${data.id}:${quote.service_id}`)
    .digest("hex");
  const { data: existing } = await supabase.from("shipment_labels")
    .select("id, status, melhor_envio_order_id, print_url")
    .eq("order_id", data.id).eq("provider", "melhor_envio").maybeSingle();
  if (existing?.melhor_envio_order_id) {
    return existing;
  }

  const { data: label, error: labelError } = await supabase.from("shipment_labels").insert({
    order_id: data.id,
    provider: "melhor_envio",
    status: "pending",
    created_by: actorId,
    purchase_idempotency_key: idempotencyKey,
    service_id: quote.service_id,
    carrier_name: quote.carrier_name,
    service_name: quote.service_name,
  }).select("id").single();
  if (labelError || !label) {
    throw new Error(labelError?.message ?? "Não foi possível iniciar a etiqueta.");
  }

  try {
    const products = data.order_items.map((item) => ({
      name: String(item.product_snapshot?.name ?? "Produto Bispo Store").slice(0, 72),
      quantity: item.quantity,
      unitary_value: Number(item.unit_price),
    }));
    const volumes = data.order_items.map((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return {
        height: Number(product.height_cm),
        width: Number(product.width_cm),
        length: Number(product.length_cm),
        weight: Number(product.weight_kg) * item.quantity,
      };
    });
    const cart = await melhorEnvioRequest<MelhorEnvioCartResponse>("/api/v2/me/cart", {
      method: "POST",
      body: JSON.stringify({
        service: Number(quote.service_id),
        from: {
          name: settings.store_name,
          phone: requiredFiscal(settings.sender_phone, "Telefone do remetente"),
          email: settings.commercial_email,
          document: cnpj,
          company_document: cnpj,
          state_register: settings.state_registration,
          postal_code: settings.origin_postal_code.replace(/\D/g, ""),
          address: origin.street,
          number: origin.number,
          district: requiredFiscal(settings.origin_district, "Bairro de origem"),
          city: settings.origin_city,
          state_abbr: settings.origin_state,
        },
        to: {
          name: customer.full_name,
          phone: customer.whatsapp.replace(/\D/g, ""),
          email: customer.email,
          postal_code: address.postal_code.replace(/\D/g, ""),
          address: address.street,
          number: address.number,
          complement: address.complement ?? "",
          district: address.district,
          city: address.city,
          state_abbr: address.state,
        },
        products,
        volumes,
        options: {
          insurance_value: products.reduce((sum, item) => sum + item.unitary_value * item.quantity, 0),
          receipt: false,
          own_hand: false,
          invoice: { key: invoiceKey },
        },
      }),
    });
    const melhorEnvioOrderId = cart.id ?? cart.order?.id;
    if (!melhorEnvioOrderId) throw new Error("O Melhor Envio não retornou o ID do envio no carrinho.");
    await supabase.from("shipment_labels").update({
      melhor_envio_order_id: melhorEnvioOrderId,
      status: "in_cart",
      provider_payload: { cart_id: melhorEnvioOrderId, environment: "sandbox" },
    }).eq("id", label.id);
    await supabase.from("orders").update({ invoice_key: invoiceKey }).eq("id", data.id);

    await melhorEnvioRequest("/api/v2/me/shipment/checkout", {
      method: "POST",
      body: JSON.stringify({ orders: [melhorEnvioOrderId] }),
    });
    await supabase.from("shipment_labels").update({
      status: "purchased",
      purchased_at: new Date().toISOString(),
    }).eq("id", label.id);

    await melhorEnvioRequest("/api/v2/me/shipment/generate", {
      method: "POST",
      body: JSON.stringify({ orders: [melhorEnvioOrderId] }),
    });
    const { data: completed } = await supabase.from("shipment_labels").update({
      status: "generated",
      generated_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", label.id).select("id, status, melhor_envio_order_id, print_url").single();
    return completed;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Falha desconhecida na etiqueta.";
    await supabase.from("shipment_labels").update({ status: "error", last_error: message }).eq("id", label.id);
    await recordIntegrationError({
      provider: "melhor_envio",
      operation: "purchase_label",
      orderId: data.id,
      retryable: true,
      message,
      safeContext: { orderNumber },
    });
    throw caught;
  }
}

export async function printMelhorEnvioLabel(orderNumber: string) {
  assertMelhorEnvioLabelPurchaseEnabled();
  const supabase = createSupabaseServiceClient();
  const { data: label } = await supabase.from("shipment_labels")
    .select("id, melhor_envio_order_id, orders!inner(order_number)")
    .eq("provider", "melhor_envio")
    .eq("orders.order_number", orderNumber)
    .single();
  if (!label?.melhor_envio_order_id) throw new Error("Etiqueta ainda não foi gerada.");
  const printed = await melhorEnvioRequest<MelhorEnvioPrintResponse>("/api/v2/me/shipment/print", {
    method: "POST",
    body: JSON.stringify({ mode: "public", orders: [label.melhor_envio_order_id] }),
  });
  if (!printed.url) throw new Error("O Melhor Envio ainda não disponibilizou o link de impressão.");
  await supabase.from("shipment_labels").update({
    status: "printed", print_url: printed.url, last_error: null,
  }).eq("id", label.id);
  return { printUrl: printed.url };
}

export async function trackMelhorEnvioLabel(orderNumber: string) {
  assertMelhorEnvioLabelPurchaseEnabled();
  const supabase = createSupabaseServiceClient();
  const { data: label } = await supabase.from("shipment_labels")
    .select("id, melhor_envio_order_id, orders!inner(order_number)")
    .eq("provider", "melhor_envio").eq("orders.order_number", orderNumber).single();
  if (!label?.melhor_envio_order_id) throw new Error("Envio ainda não comprado.");
  const tracking = await melhorEnvioRequest<Record<string, unknown>>("/api/v2/me/shipment/tracking", {
    method: "POST",
    body: JSON.stringify({ orders: [label.melhor_envio_order_id] }),
  });
  const entry = tracking[label.melhor_envio_order_id] as Record<string, unknown> | undefined;
  await supabase.from("shipment_labels").update({
    tracking_code: typeof entry?.tracking === "string" ? entry.tracking : null,
    last_tracked_at: new Date().toISOString(),
    provider_payload: { tracking: entry ?? tracking },
  }).eq("id", label.id);
  return entry ?? tracking;
}
