import type {
  PackagingCategory,
  Product,
  ProductCategory,
  SellableProductCategory,
} from "@/types/commerce";

export const sellableCategories = ["tenis", "calcas", "conjuntos"] as const;

export const publicCategoryLabels: Record<string, string> = {
  tenis: "Tênis",
  calcas: "Calças",
  conjuntos: "Conjuntos",
};

export const archivedCategoryLabels = {
  camisetas: "Camisetas",
  moletons: "Moletons",
  "calcas-shorts": "Calças & shorts (legado)",
} as const;

export const allCategoryLabels: Record<string, string> = {
  ...publicCategoryLabels,
  ...archivedCategoryLabels,
};

export const shippingDefaults: Record<(typeof sellableCategories)[number], {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  packagingCategory: PackagingCategory;
}> = {
  tenis: {
    weightKg: 1.25,
    lengthCm: 33,
    widthCm: 20,
    heightCm: 12,
    packagingCategory: "caixa-tenis",
  },
  calcas: {
    weightKg: 0.6,
    lengthCm: 30,
    widthCm: 25,
    heightCm: 5,
    packagingCategory: "pacote-roupa",
  },
  conjuntos: {
    weightKg: 1.2,
    lengthCm: 40,
    widthCm: 30,
    heightCm: 12,
    packagingCategory: "caixa-conjunto",
  },
};

export function isSellableCategory(category: ProductCategory): category is SellableProductCategory {
  return Boolean(category) && !Object.prototype.hasOwnProperty.call(archivedCategoryLabels, category);
}

export function isPublicProduct(product: Product) {
  return product.active && product.status !== "draft" && isSellableCategory(product.category);
}

export function defaultsForCategory(category: ProductCategory) {
  return Object.prototype.hasOwnProperty.call(shippingDefaults, category)
    ? shippingDefaults[category as keyof typeof shippingDefaults]
    : undefined;
}

export function categoryLabel(slug: string) {
  return allCategoryLabels[slug]
    ?? slug.split("-").map((part) => part ? part[0].toLocaleUpperCase("pt-BR") + part.slice(1) : part).join(" ");
}
