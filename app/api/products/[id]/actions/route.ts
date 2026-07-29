import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { isSellableCategory } from "@/lib/product-rules";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { validateProduct } from "@/lib/validation/commerce";
import { fetchProducts, saveSupabaseProduct } from "@/repositories/supabase-product-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const { id } = await params;
  let action: "duplicate" | "publish" | "deactivate" | undefined;
  try {
    ({ action } = await readJsonBody<{ action?: "duplicate" | "publish" | "deactivate" }>(request, 4096));
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const [product] = await fetchProducts({ includeInactive: true, id });
  if (!product) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

  try {
    if (action === "duplicate") {
      const suffix = Date.now().toString().slice(-7);
      return NextResponse.json(await saveSupabaseProduct(validateProduct({
        ...product,
        id: "",
        name: `${product.name} — cópia`,
        slug: `${product.slug}-copia-${suffix}`,
        code: `${product.code}-C${suffix.slice(-3)}`,
        status: "draft",
        active: false,
        needsReview: true,
      })), { status: 201 });
    }
    if (action === "publish") {
      if (!isSellableCategory(product.category)) {
        return NextResponse.json({ error: "Mova o produto para uma categoria ativa antes de publicar." }, { status: 400 });
      }
      return NextResponse.json(await saveSupabaseProduct(validateProduct({
        ...product,
        status: "active",
        active: true,
        needsReview: false,
      }), id));
    }
    if (action === "deactivate") {
      return NextResponse.json(await saveSupabaseProduct(validateProduct({
        ...product,
        status: "inactive",
        active: false,
      }), id));
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ação não concluída." }, { status: 400 });
  }
}
