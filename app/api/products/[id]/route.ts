import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { defaultsForCategory } from "@/lib/product-rules";
import { productCompleteness } from "@/lib/products/completeness";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { validateProduct } from "@/lib/validation/commerce";
import {
  fetchProducts,
  saveSupabaseProduct,
  softDeleteSupabaseProduct,
} from "@/repositories/supabase-product-repository";
import type { Product } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [product] = await fetchProducts({ includeInactive: true, id });
  return product
    ? NextResponse.json(product)
    : NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const { id } = await params;
  const [current] = await fetchProducts({ includeInactive: true, id });
  if (!current) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  let input: Partial<Product>;
  try {
    input = await readJsonBody<Partial<Product>>(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const category = input.category ?? current.category;
  const defaults = defaultsForCategory(category);
  const product: Product = {
    ...current,
    ...input,
    id,
    category,
    weightKg: input.weightKg ?? defaults?.weightKg ?? current.weightKg,
    lengthCm: input.lengthCm ?? defaults?.lengthCm ?? current.lengthCm,
    widthCm: input.widthCm ?? defaults?.widthCm ?? current.widthCm,
    heightCm: input.heightCm ?? defaults?.heightCm ?? current.heightCm,
    packagingCategory: input.packagingCategory ?? defaults?.packagingCategory ?? current.packagingCategory,
    active: input.status ? input.status === "active" : current.active,
    demo: true,
  };
  try {
    const validated = validateProduct(product);
    const completeness = productCompleteness(validated);
    return NextResponse.json(await saveSupabaseProduct({
      ...validated,
      needsReview: !completeness.complete,
    }, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Produto não salvo." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const { id } = await params;
  try {
    await softDeleteSupabaseProduct(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Produto não arquivado." }, { status: 400 });
  }
}
