import type { Product } from "@/types/commerce";

const provisionalNamePatterns = [
  /^(?:t[eê]nis|cal[cç]a|conjunto)\s+\d{1,3}$/iu,
  /^novo produto(?:\s+\d+)?$/iu,
];

const provisionalDescriptionPattern =
  /aguardando cadastro|produto provis[oó]rio|descri[cç][aã]o pendente/iu;

export type ProductCompleteness = {
  complete: boolean;
  missing: string[];
};

export function productCompleteness(product: Product): ProductCompleteness {
  const missing: string[] = [];
  const name = product.name.trim();
  const description = product.description.trim();

  if (!name || provisionalNamePatterns.some((pattern) => pattern.test(name))) {
    missing.push("nome definitivo");
  }
  if (!description || provisionalDescriptionPattern.test(description)) {
    missing.push("descrição definitiva");
  }
  if (!["tenis", "calcas", "conjuntos"].includes(product.category)) {
    missing.push("categoria ativa");
  }
  if (!Number.isFinite(product.price) || product.price <= 0) {
    missing.push("preço");
  }
  if (!product.images.length) missing.push("imagem");
  if (!product.imagesConfirmed) missing.push("confirmação das imagens");
  if (!product.sizes.length || product.sizes.some((size) => /a definir/i.test(size))) {
    missing.push("tamanhos");
  }
  if (!product.colors.length || product.colors.some((color) => /a definir/i.test(color))) {
    missing.push("cores");
  }
  if (!Number.isInteger(product.stock) || product.stock < 0) {
    missing.push("estoque");
  }

  return { complete: missing.length === 0, missing };
}

export function isProductComplete(product: Product) {
  return productCompleteness(product).complete;
}
