import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { hasSupabasePublicEnv } from "@/lib/supabase/env";
import type { Product, ProductCategory } from "@/types/commerce";

const productSelect = `
  id,
  legacy_id,
  name,
  slug,
  code,
  description,
  price,
  promotional_price,
  weight_kg,
  length_cm,
  width_cm,
  height_cm,
  packaging_category,
  shipping_enabled,
  featured,
  is_new,
  status,
  needs_review,
  categories!inner(slug),
  product_images(id, storage_path, public_url, thumbnail_storage_path, thumbnail_public_url, alt_text, position, is_cover),
  product_variants(id, sku, size, color, stock, active)
`;

type ProductRecord = {
  id: string;
  legacy_id: string | null;
  name: string;
  slug: string;
  code: string;
  description: string;
  price: number | string;
  promotional_price: number | string | null;
  weight_kg: number | string | null;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  packaging_category: Product["packagingCategory"];
  shipping_enabled: boolean;
  featured: boolean;
  is_new: boolean;
  status: "active" | "inactive" | "draft" | "archived";
  needs_review: boolean;
  categories: { slug: ProductCategory } | Array<{ slug: ProductCategory }>;
  product_images: Array<{
    id: string;
    storage_path: string;
    public_url: string;
    thumbnail_storage_path: string | null;
    thumbnail_public_url: string | null;
    alt_text: string | null;
    position: number;
    is_cover: boolean;
  }>;
  product_variants: Array<{
    id: string;
    sku: string;
    size: string;
    color: string;
    stock: number;
    active: boolean;
  }>;
};

function numberOrUndefined(value: number | string | null) {
  return value === null ? undefined : Number(value);
}

export function mapProductRecord(row: ProductRecord): Product {
  const category = Array.isArray(row.categories) ? row.categories[0]?.slug : row.categories.slug;
  const images = [...(row.product_images ?? [])].sort((a, b) => a.position - b.position);
  const variants = (row.product_variants ?? []).filter((variant) => variant.active);
  const sizes = [...new Set(variants.map((variant) => variant.size))];
  const colors = [...new Set(variants.map((variant) => variant.color))];
  const cover = images.find((image) => image.is_cover) ?? images[0];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    code: row.code,
    category,
    description: row.description,
    price: Number(row.price),
    promotionalPrice: numberOrUndefined(row.promotional_price),
    images: images.map((image) => image.public_url),
    thumbnails: images.map((image) => image.thumbnail_public_url ?? image.public_url),
    coverImage: cover?.public_url,
    imageType: "photo",
    sizes,
    colors,
    stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
    weightKg: numberOrUndefined(row.weight_kg),
    lengthCm: numberOrUndefined(row.length_cm),
    widthCm: numberOrUndefined(row.width_cm),
    heightCm: numberOrUndefined(row.height_cm),
    packagingCategory: row.packaging_category,
    shippingEnabled: row.shipping_enabled,
    featured: row.featured,
    isNew: row.is_new,
    active: row.status === "active",
    status: row.status,
    needsReview: row.needs_review,
    imagesConfirmed: !row.needs_review && images.length > 0,
    demo: true,
    visual: {
      accent: "#ef2b35",
      secondary: "#f7f7f4",
      type: category === "tenis" ? "shoe" : "bottom",
    },
  };
}

function storagePathFromUrl(url: string) {
  const marker = "/storage/v1/object/public/product-images/";
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : url.replace(/^\/+/, "");
}

function variantRows(productId: string, product: Product) {
  const combinations = product.sizes.flatMap((size) =>
    product.colors.map((color) => ({ size, color }))
  );
  const count = Math.max(1, combinations.length);
  return combinations.map(({ size, color }, index) => ({
    product_id: productId,
    sku: `${product.code}-${size}-${color}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .toUpperCase(),
    size,
    color,
    stock: Math.floor(product.stock / count) + (index < product.stock % count ? 1 : 0),
    active: true,
  }));
}

export type ProductQueryOptions = {
  includeInactive?: boolean;
  id?: string;
  ids?: string[];
  slug?: string;
  category?: ProductCategory;
  search?: string;
  status?: Product["status"];
  isNew?: boolean;
  featured?: boolean;
  onSale?: boolean;
  sort?: "newest" | "menor" | "maior";
  offset?: number;
  limit?: number;
};

type ProductQueryResult = {
  products: Product[];
  total: number;
};

async function executeProductQuery(
  options: ProductQueryOptions,
  publicRead: boolean,
  count = false,
): Promise<ProductQueryResult> {
  if (!hasSupabasePublicEnv()) return { products: [], total: 0 };
  const supabase = publicRead
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();
  let query = supabase
    .from("products")
    .select(productSelect, count ? { count: "exact" } : undefined)
    .is("deleted_at", null);
  if (publicRead) query = query.not("name", "ilike", "%[TESTE SANDBOX]%");
  if (!options?.includeInactive) query = query.eq("status", "active");
  if (options?.id) query = query.eq("id", options.id);
  if (options?.ids?.length) query = query.in("id", options.ids);
  if (options?.slug) query = query.eq("slug", options.slug);
  if (options?.category) query = query.eq("categories.slug", options.category);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.isNew !== undefined) query = query.eq("is_new", options.isNew);
  if (options?.featured !== undefined) query = query.eq("featured", options.featured);
  if (options?.onSale) query = query.not("promotional_price", "is", null);
  if (options?.search) {
    const term = options.search.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%,code.ilike.%${term}%`);
  }
  if (options?.sort === "menor") {
    query = query.order("price", { ascending: true });
  } else if (options?.sort === "maior") {
    query = query.order("price", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }
  if (options?.limit !== undefined) {
    const offset = Math.max(0, options.offset ?? 0);
    query = query.range(offset, offset + Math.max(1, options.limit) - 1);
  }
  const { data, error, count: total } = await query;
  if (error) throw new Error(`Falha ao consultar produtos: ${error.message}`);
  const products = (data as unknown as ProductRecord[]).map(mapProductRecord);
  return { products, total: count ? total ?? products.length : products.length };
}

function normalizedListOptions(options: ProductQueryOptions): ProductQueryOptions {
  return {
    id: options.id,
    ids: options.ids ? [...new Set(options.ids)].sort() : undefined,
    slug: options.slug,
    category: options.category,
    search: options.search,
    status: options.status,
    isNew: options.isNew,
    featured: options.featured,
    onSale: options.onSale,
    sort: options.sort,
  };
}

function normalizedPageOptions(
  options: ProductQueryOptions & { offset: number; limit: number },
): ProductQueryOptions & { offset: number; limit: number } {
  return {
    offset: Math.max(0, options.offset),
    limit: Math.max(1, options.limit),
    category: options.category,
    search: options.search,
    status: options.status,
    isNew: options.isNew,
    featured: options.featured,
    onSale: options.onSale,
    sort: options.sort,
  };
}

async function fetchCachedPublicProductList(options: ProductQueryOptions) {
  const normalized = normalizedListOptions(options);
  const cacheKey = JSON.stringify(normalized);
  return unstable_cache(
    () => executeProductQuery(normalized, true, false),
    ["public-product-list-v3", cacheKey],
    { revalidate: 60, tags: ["public-products"] },
  )();
}

async function fetchCachedPublicProductPage(
  options: ProductQueryOptions & { offset: number; limit: number },
) {
  const normalized = normalizedPageOptions(options);
  const cacheKey = JSON.stringify(normalized);
  return unstable_cache(
    () => executeProductQuery(normalized, true, true),
    ["public-product-page-v3", cacheKey],
    { revalidate: 60, tags: ["public-products"] },
  )();
}

export async function fetchProducts(options: ProductQueryOptions = {}) {
  if (!hasSupabasePublicEnv()) return [];
  const result = options.includeInactive
    ? await executeProductQuery(options, false)
    : await fetchCachedPublicProductList(options);
  return result.products;
}

export async function fetchProductPage(
  options: ProductQueryOptions & { offset: number; limit: number },
) {
  if (!hasSupabasePublicEnv()) return { products: [], total: 0 };
  return options.includeInactive
    ? executeProductQuery(options, false, true)
    : fetchCachedPublicProductPage(options);
}
export async function saveSupabaseProduct(input: Product, id?: string) {
  const supabase = await createSupabaseServerClient();
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", input.category)
    .single();
  if (categoryError || !category) throw new Error("Categoria não encontrada no Supabase.");

  const payload = {
    category_id: category.id,
    name: input.name,
    slug: input.slug,
    code: input.code,
    description: input.description,
    price: input.price,
    promotional_price: input.promotionalPrice ?? null,
    weight_kg: input.weightKg ?? null,
    length_cm: input.lengthCm ?? null,
    width_cm: input.widthCm ?? null,
    height_cm: input.heightCm ?? null,
    packaging_category: input.packagingCategory ?? "a-definir",
    shipping_enabled: input.shippingEnabled ?? false,
    featured: input.featured,
    is_new: input.isNew,
    status: input.status ?? (input.active ? "active" : "draft"),
    needs_review: input.needsReview ?? true,
    published_at: input.status === "active" ? new Date().toISOString() : null,
  };
  const productMutation = id
    ? supabase.from("products").update(payload).eq("id", id).select(productSelect).single()
    : supabase.from("products").insert(payload).select(productSelect).single();
  const { data: saved, error: productError } = await productMutation;
  if (productError || !saved) throw new Error(productError?.message ?? "Produto não salvo.");
  const productId = saved.id as string;

  const { error: deleteImagesError } = await supabase.from("product_images").delete().eq("product_id", productId);
  if (deleteImagesError) throw new Error(deleteImagesError.message);
  if (input.images.length) {
    const { error: imagesError } = await supabase.from("product_images").insert(
      input.images.map((url, position) => ({
        product_id: productId,
        storage_path: storagePathFromUrl(url),
        public_url: url,
        thumbnail_storage_path: input.thumbnails?.[position] ? storagePathFromUrl(input.thumbnails[position]) : storagePathFromUrl(url),
        thumbnail_public_url: input.thumbnails?.[position] ?? url,
        alt_text: `${input.name} — imagem ${position + 1}`,
        position,
        is_cover: (input.coverImage ?? input.images[0]) === url,
      }))
    );
    if (imagesError) throw new Error(imagesError.message);
  }

  const variants = variantRows(productId, input);
  const { error: variantsError } = await supabase.rpc("replace_product_variants", {
    target_product_id: productId,
    variants_data: variants.map(({ sku, size, color, stock, active }) => ({
      sku,
      size,
      color,
      stock,
      active,
    })),
  });
  if (variantsError) throw new Error(variantsError.message);

  revalidateTag("public-products", { expire: 0 });
  const [result] = await fetchProducts({ includeInactive: true, slug: input.slug });
  if (!result) throw new Error("Produto salvo, mas não pôde ser recarregado.");
  return result;
}

export async function softDeleteSupabaseProduct(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("products")
    .update({ status: "archived", shipping_enabled: false, published_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag("public-products", { expire: 0 });
}
