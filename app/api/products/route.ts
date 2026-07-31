import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { defaultsForCategory } from "@/lib/product-rules";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { validateProduct } from "@/lib/validation/commerce";
import {
  fetchProductPage,
  fetchProducts,
  saveSupabaseProduct,
} from "@/repositories/supabase-product-repository";
import type {
  Product,
  ProductCategory,
  ProductStatus,
  SellableProductCategory,
} from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";
  if (includeInactive) await requireAdmin();
  const hasIdsParameter = request.nextUrl.searchParams.has("ids");
  const ids = [...new Set((request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)))]
    .sort()
    .slice(0, 30);
  const categoryValue = request.nextUrl.searchParams.get("category");
  const category = ["tenis", "calcas", "conjuntos"].includes(categoryValue ?? "")
    ? categoryValue as SellableProductCategory
    : undefined;
  const statusValue = request.nextUrl.searchParams.get("status");
  const status = includeInactive
    && ["active", "inactive", "draft", "archived"].includes(statusValue ?? "")
    ? statusValue as ProductStatus
    : undefined;
  const filter = request.nextUrl.searchParams.get("filter");
  const sortValue = request.nextUrl.searchParams.get("sort");
  const sort = sortValue === "menor" || sortValue === "maior"
    ? sortValue
    : "newest";
  const search = request.nextUrl.searchParams.get("search") ?? undefined;

  if (hasIdsParameter) {
    const products = ids.length
      ? await fetchProducts({ includeInactive, ids })
      : [];
    return NextResponse.json(products, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (request.nextUrl.searchParams.get("paginated") === "true") {
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(request.nextUrl.searchParams.get("pageSize")) || 24),
    );
    const result = await fetchProductPage({
      includeInactive,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      category: category as ProductCategory | undefined,
      status,
      search,
      isNew: filter === "lancamentos" || sortValue === "novos"
        ? true
        : undefined,
      onSale: filter === "ofertas",
      sort,
    });
    return NextResponse.json({ ...result, page, pageSize }, {
      headers: {
        "Cache-Control": includeInactive
          ? "private, no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  }

  return NextResponse.json(await fetchProducts({
    includeInactive,
    category: category as ProductCategory | undefined,
    status,
    search,
  }), {
    headers: {
      "Cache-Control": includeInactive
        ? "private, no-store"
        : "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  let input: Partial<Product>;
  try {
    assertSameOrigin(request);
    input = await readJsonBody<Partial<Product>>(request);
  } catch (error) {
    return validationErrorResponse(error)
      ?? NextResponse.json({ error: "Não foi possível validar o produto." }, { status: 400 });
  }
  const category = input.category ?? "tenis";
  const defaults = defaultsForCategory(category);
  const product: Product = {
    id: "",
    name: input.name ?? "Novo produto",
    slug: input.slug ?? `novo-produto-${Date.now()}`,
    code: input.code ?? `BSP-${String(Date.now()).slice(-7)}`,
    category,
    description: input.description ?? "",
    price: input.price ?? 0,
    promotionalPrice: input.promotionalPrice,
    images: input.images ?? [],
    coverImage: input.coverImage,
    imageType: "photo",
    sizes: input.sizes ?? ["38", "39", "40", "41", "42"],
    colors: input.colors ?? ["A definir"],
    stock: input.stock ?? 0,
    weightKg: input.weightKg ?? defaults?.weightKg,
    lengthCm: input.lengthCm ?? defaults?.lengthCm,
    widthCm: input.widthCm ?? defaults?.widthCm,
    heightCm: input.heightCm ?? defaults?.heightCm,
    packagingCategory: input.packagingCategory ?? defaults?.packagingCategory ?? "a-definir",
    shippingEnabled: input.shippingEnabled ?? true,
    featured: input.featured ?? false,
    isNew: input.isNew ?? false,
    active: input.status === "active",
    status: input.status ?? "draft",
    needsReview: input.needsReview ?? true,
    demo: true,
    visual: input.visual ?? { accent: "#ef2b35", secondary: "#f7f7f4", type: category === "tenis" ? "shoe" : "bottom" },
  };
  try {
    return NextResponse.json(await saveSupabaseProduct(validateProduct(product)), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Produto não salvo." }, { status: 400 });
  }
}
