import type {
  PackagingCategory,
  Product,
  ProductCategory,
  SellableProductCategory,
} from "@/types/commerce";

export const sellableCategories: SellableProductCategory[] = ["tenis", "calcas", "conjuntos"];

export const publicCategoryLabels: Record<SellableProductCategory, string> = {
  tenis: "Tênis",
  calcas: "Calças",
  conjuntos: "Conjuntos",
};

export const archivedCategoryLabels = {
  camisetas: "Camisetas",
  moletons: "Moletons",
  "calcas-shorts": "Calças & shorts (legado)",
} as const;

export const allCategoryLabels: Record<ProductCategory, string> = {
  ...publicCategoryLabels,
  ...archivedCategoryLabels,
};

export const shippingDefaults: Record<SellableProductCategory, {
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
  return sellableCategories.includes(category as SellableProductCategory);
}

export function isPublicProduct(product: Product) {
  return product.active && product.status !== "draft" && isSellableCategory(product.category);
}

export function defaultsForCategory(category: ProductCategory) {
  return isSellableCategory(category) ? shippingDefaults[category] : undefined;
}
