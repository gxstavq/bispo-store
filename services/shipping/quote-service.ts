import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  calculateMelhorEnvioShipping,
  type MelhorEnvioProduct,
} from "@/services/melhor-envio/client";
import { recordIntegrationError } from "@/services/integration-errors";
import type { CartItem, ShippingQuote } from "@/types/commerce";

type CatalogProduct = {
  id: string;
  code: string;
  price: number | string;
  promotional_price: number | string | null;
  weight_kg: number | string | null;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  shipping_enabled: boolean;
  status: string;
};

type CatalogVariant = {
  id: string;
  product_id: string;
  size: string;
  color: string;
  stock: number;
  active: boolean;
};

function normalizePostalCode(value: string) {
  const postalCode = value.replace(/\D/g, "");
  if (postalCode.length !== 8) throw new Error("Informe um CEP válido com 8 dígitos.");
  return postalCode;
}

function normalizeItems(items: CartItem[]) {
  const grouped = new Map<string, CartItem>();
  for (const item of items) {
    const quantity = Math.floor(Number(item.quantity));
    if (!item.productId || !item.size || !item.color || quantity < 1 || quantity > 20) {
      throw new Error("Carrinho inválido para cotação.");
    }
    const key = `${item.productId}\0${item.size}\0${item.color}`;
    const current = grouped.get(key);
    grouped.set(key, { ...item, quantity: (current?.quantity ?? 0) + quantity });
  }
  return [...grouped.values()].sort((a, b) =>
    `${a.productId}:${a.size}:${a.color}`.localeCompare(`${b.productId}:${b.size}:${b.color}`)
  );
}

export function quoteFingerprint(postalCode: string, snapshot: unknown) {
  return createHash("sha256")
    .update(`${normalizePostalCode(postalCode)}\0${JSON.stringify(snapshot)}`)
    .digest("hex");
}

export async function createMelhorEnvioQuotes(input: {
  userId: string;
  destinationPostalCode: string;
  items: CartItem[];
}): Promise<ShippingQuote[]> {
  const destinationPostalCode = normalizePostalCode(input.destinationPostalCode);
  const items = normalizeItems(input.items);
  const productIds = [...new Set(items.map((item) => item.productId))];
  const supabase = createSupabaseServiceClient();
  const [{ data: productRows, error: productError }, { data: variantRows, error: variantError }] = await Promise.all([
    supabase.from("products")
      .select("id, code, price, promotional_price, weight_kg, length_cm, width_cm, height_cm, shipping_enabled, status")
      .in("id", productIds)
      .is("deleted_at", null),
    supabase.from("product_variants")
      .select("id, product_id, size, color, stock, active")
      .in("product_id", productIds),
  ]);
  if (productError || variantError) throw new Error(productError?.message ?? variantError?.message);

  const products = new Map((productRows as CatalogProduct[]).map((product) => [product.id, product]));
  const variants = variantRows as CatalogVariant[];
  const snapshot = items.map((item) => {
    const product = products.get(item.productId);
    const variant = variants.find((candidate) =>
      candidate.product_id === item.productId
      && candidate.size === item.size
      && candidate.color === item.color
      && candidate.active
    );
    if (!product || product.status !== "active" || !product.shipping_enabled) {
      throw new Error("Um produto do carrinho não está disponível para envio.");
    }
    if (!variant || variant.stock < item.quantity) throw new Error("Estoque insuficiente para cotação.");
    const dimensions = [
      product.weight_kg, product.length_cm, product.width_cm, product.height_cm,
    ].map((value) => value === null ? null : Number(value));
    if (dimensions.some((value) => value === null || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`O produto ${product.code} não possui peso e dimensões válidos.`);
    }
    return {
      product_id: product.id,
      variant_id: variant.id,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      unit_price: Number(product.promotional_price ?? product.price),
      weight_kg: dimensions[0]!,
      length_cm: dimensions[1]!,
      width_cm: dimensions[2]!,
      height_cm: dimensions[3]!,
    };
  });

  const apiProducts: MelhorEnvioProduct[] = snapshot.map((item) => ({
    id: `${item.product_id}:${item.variant_id}`,
    width: item.width_cm,
    height: item.height_cm,
    length: item.length_cm,
    weight: item.weight_kg,
    insurance_value: item.unit_price,
    quantity: item.quantity,
  }));

  try {
    const apiQuotes = await calculateMelhorEnvioShipping(destinationPostalCode, apiProducts);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const fingerprint = quoteFingerprint(destinationPostalCode, snapshot);
    const validQuotes = apiQuotes.flatMap((quote) => {
      const amount = Number(quote.custom_price);
      const deliveryDays = Number(quote.custom_delivery_time);
      if (
        quote.error
        || !quote.company?.name
        || !quote.name
        || !Number.isFinite(amount)
        || amount < 0
        || !Number.isFinite(deliveryDays)
        || deliveryDays < 0
      ) {
        return [];
      }
      return [{
        customer_user_id: input.userId,
        provider: "melhor_envio",
        provider_quote_id: String(quote.id),
        carrier_name: quote.company.name,
        service_id: String(quote.id),
        service_name: quote.name,
        amount,
        delivery_days: deliveryDays,
        destination_postal_code: destinationPostalCode,
        cart_snapshot: snapshot,
        provider_payload: quote,
        expires_at: expiresAt,
        selected: false,
        created_by: input.userId,
        error_message: null,
        quote_fingerprint: fingerprint,
      }];
    });
    if (!validQuotes.length) throw new Error("O Melhor Envio não retornou serviços válidos para este carrinho.");
    const { data: saved, error } = await supabase
      .from("shipping_quotes")
      .insert(validQuotes)
      .select("id, carrier_name, service_id, service_name, amount, delivery_days, expires_at");
    if (error) throw new Error(error.message);
    return saved.map((quote) => ({
      id: quote.id,
      carrier: quote.carrier_name,
      serviceId: quote.service_id,
      service: quote.service_name,
      amount: Number(quote.amount),
      deliveryDays: quote.delivery_days,
      expiresAt: quote.expires_at,
    }));
  } catch (error) {
    await recordIntegrationError({
      provider: "melhor_envio",
      operation: "shipping_quote",
      retryable: true,
      message: error instanceof Error ? error.message : "Falha de cotação desconhecida.",
      safeContext: { destinationPostalCode, itemCount: items.length },
    });
    throw error;
  }
}
