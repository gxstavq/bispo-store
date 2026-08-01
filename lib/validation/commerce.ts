import "server-only";

import type {
  CartItem,
  CheckoutData,
  PackagingCategory,
  Product,
  ProductStatus,
} from "@/types/commerce";
import { isBrazilianState } from "@/lib/brazilian-states";
import { RequestValidationError } from "@/lib/security/request";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const productStatuses = new Set<ProductStatus>(["active", "inactive", "draft", "archived"]);
const packagingCategories = new Set<PackagingCategory>([
  "caixa-tenis", "pacote-roupa", "caixa-conjunto", "a-definir",
]);

function textValue(value: unknown, label: string, max: number, min = 1) {
  if (typeof value !== "string") throw new RequestValidationError(`${label} inválido.`);
  const normalized = value.replace(/\0/g, "").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new RequestValidationError(`${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === "") return "";
  return textValue(value, label, max);
}

function finiteNumber(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RequestValidationError(`${label} inválido.`);
  }
  return number;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new RequestValidationError(`${label} inválido.`);
  }
  return [...new Set(value.map((item) => textValue(item, label, 64)))];
}

function safeImageReference(value: unknown) {
  const image = textValue(value, "Imagem", 2048);
  if (image.startsWith("/")) {
    if (image.startsWith("//") || image.includes("\\")) {
      throw new RequestValidationError("Caminho de imagem inválido.");
    }
    return image;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(image)) return image;
  try {
    const url = new URL(image);
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local").hostname;
    if (
      url.protocol !== "https:"
      || url.hostname !== supabaseHost
      || !url.pathname.startsWith("/storage/v1/object/public/product-images/")
    ) {
      throw new Error("untrusted");
    }
    return url.toString();
  } catch {
    throw new RequestValidationError("A imagem deve pertencer ao Storage da Bispo Store.");
  }
}

export function validateCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new RequestValidationError("O carrinho deve conter entre 1 e 20 itens.");
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new RequestValidationError("Item do carrinho inválido.");
    const item = raw as Record<string, unknown>;
    const productId = textValue(item.productId, "Produto", 36);
    if (!uuidPattern.test(productId)) throw new RequestValidationError("Produto inválido.");
    const quantity = finiteNumber(item.quantity, "Quantidade", 1, 20);
    if (!Number.isInteger(quantity)) throw new RequestValidationError("Quantidade deve ser inteira.");
    return {
      productId,
      size: textValue(item.size, "Tamanho", 64),
      color: textValue(item.color, "Cor", 64),
      quantity,
    };
  });
}

export function validateCheckoutData(value: unknown): CheckoutData {
  if (!value || typeof value !== "object") throw new RequestValidationError("Dados do checkout inválidos.");
  const input = value as Record<string, unknown>;
  const postalCode = String(input.cep ?? "").replace(/\D/g, "");
  if (postalCode.length !== 8) throw new RequestValidationError("Informe um CEP válido com 8 dígitos.");
  const whatsapp = String(input.whatsapp ?? "").replace(/\D/g, "");
  if (whatsapp.length < 10 || whatsapp.length > 15) throw new RequestValidationError("WhatsApp inválido.");
  const email = textValue(input.email, "E-mail", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestValidationError("E-mail inválido.");
  const state = String(input.state ?? "").toUpperCase();
  if (!isBrazilianState(state)) throw new RequestValidationError("Selecione uma UF válida.");
  if (input.deliveryChoice !== "local_delivery_review" && input.deliveryChoice !== "shipping_quote") {
    throw new RequestValidationError("Opção de entrega inválida.");
  }
  if (input.deliveryChoice === "local_delivery_review" && state !== "SP") {
    throw new RequestValidationError("A análise de entrega local está disponível somente para endereços em SP.");
  }
  const selectedQuote = input.selectedShippingQuoteId;
  if (input.deliveryChoice === "shipping_quote") {
    if (typeof selectedQuote !== "string" || !uuidPattern.test(selectedQuote)) {
      throw new RequestValidationError("Selecione uma cotação de frete válida.");
    }
  } else if (selectedQuote !== undefined && selectedQuote !== null && selectedQuote !== "") {
    throw new RequestValidationError("Cotação não permitida para entrega local.");
  }
  return {
    fullName: textValue(input.fullName, "Nome completo", 160, 2),
    whatsapp,
    email,
    cep: postalCode,
    street: textValue(input.street, "Rua", 200),
    number: textValue(input.number, "Número", 32),
    complement: optionalText(input.complement, "Complemento", 120),
    district: textValue(input.district, "Bairro", 120),
    city: textValue(input.city, "Cidade", 120),
    state,
    reference: optionalText(input.reference, "Referência", 250),
    notes: optionalText(input.notes, "Observações", 2000),
    deliveryChoice: input.deliveryChoice,
    selectedShippingQuoteId: input.deliveryChoice === "shipping_quote"
      ? selectedQuote as string
      : undefined,
  };
}

export function validateProduct(input: Product): Product {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.category)) throw new RequestValidationError("Categoria inválida.");
  const status = input.status ?? (input.active ? "active" : "draft");
  if (!productStatuses.has(status)) throw new RequestValidationError("Status inválido.");
  const price = finiteNumber(input.price, "Preço", 0, 10_000_000);
  if (status === "active" && price <= 0) {
    throw new RequestValidationError("Produtos ativos devem possuir preço maior que zero.");
  }
  const promotionalPrice = input.promotionalPrice === undefined || input.promotionalPrice === null
    ? undefined
    : finiteNumber(input.promotionalPrice, "Preço promocional", 0.01, price);
  if (promotionalPrice !== undefined && promotionalPrice >= price) {
    throw new RequestValidationError("O preço promocional deve ser menor que o preço normal.");
  }
  const stock = finiteNumber(input.stock, "Estoque", 0, 1_000_000);
  if (!Number.isInteger(stock)) throw new RequestValidationError("Estoque deve ser inteiro.");
  const slug = textValue(input.slug, "Slug", 180);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new RequestValidationError("Slug deve conter apenas letras minúsculas, números e hífens.");
  }
  const code = textValue(input.code, "Código", 64);
  if (!/^[A-Za-z0-9._-]+$/.test(code)) throw new RequestValidationError("Código inválido.");
  const packagingCategory = input.packagingCategory ?? "a-definir";
  if (!packagingCategories.has(packagingCategory)) throw new RequestValidationError("Embalagem inválida.");

  const dimension = (value: number | undefined, label: string) =>
    value === undefined || value === null
      ? undefined
      : finiteNumber(value, label, 0.01, 10_000);

  return {
    ...input,
    name: textValue(input.name, "Nome", 160),
    slug,
    code,
    description: optionalText(input.description, "Descrição", 5000),
    price,
    promotionalPrice,
    images: (input.images ?? []).slice(0, 20).map(safeImageReference),
    thumbnails: input.thumbnails?.slice(0, 20).map(safeImageReference),
    sizes: stringArray(input.sizes, "Tamanhos"),
    colors: stringArray(input.colors, "Cores"),
    stock,
    variants: input.variants?.slice(0, 250).map((variant) => {
      const variantStock = finiteNumber(variant.stock, "Estoque da variante", 0, 1_000_000);
      if (!Number.isInteger(variantStock)) throw new RequestValidationError("Estoque da variante deve ser inteiro.");
      return {
        id: variant.id,
        sku: textValue(variant.sku, "SKU", 120),
        size: textValue(variant.size, "Tamanho", 64),
        color: textValue(variant.color, "Cor", 64),
        stock: variantStock,
        active: Boolean(variant.active),
      };
    }),
    weightKg: dimension(input.weightKg, "Peso"),
    lengthCm: dimension(input.lengthCm, "Comprimento"),
    widthCm: dimension(input.widthCm, "Largura"),
    heightCm: dimension(input.heightCm, "Altura"),
    packagingCategory,
    status,
    active: status === "active",
  };
}
