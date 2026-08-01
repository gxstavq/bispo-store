import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { humanAdminError, sanitizedAdminError } from "@/lib/admin-errors";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function inventoryRows() {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("product_variants").select(`
    id,sku,size,color,stock,active,updated_at,
    products!inner(id,name,code,status)
  `).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id, sku: row.sku, size: row.size, color: row.color,
    stock: row.stock, active: row.active,
    product: Array.isArray(row.products) ? row.products[0] : row.products,
  }));
}

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ variants: await inventoryRows() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request, 8192);
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) return NextResponse.json({ error: "Informe uma quantidade inteira igual ou maior que zero." }, { status: 400 });
    const operation = input.operation;
    if (!['add', 'remove', 'set'].includes(String(operation))) return NextResponse.json({ error: "Operação de estoque inválida." }, { status: 400 });
    const reason = typeof input.reason === "string" ? input.reason.replace(/\0/g, "").trim().slice(0, 200) : "";
    const note = typeof input.note === "string" ? input.note.replace(/\0/g, "").trim().slice(0, 1000) : "";
    if (reason.length < 3) return NextResponse.json({ error: "Informe o motivo do ajuste." }, { status: 400 });
    const db = await createSupabaseServerClient();
    const { data, error } = await db.rpc("adjust_product_variant_stock", {
      target_variant_id: String(input.variantId ?? ""),
      adjustment_operation: operation,
      adjustment_quantity: quantity,
      adjustment_reason: reason,
      adjustment_note: note || null,
      request_idempotency_key: String(input.idempotencyKey ?? ""),
    });
    if (error) throw error;
    revalidateTag("public-products", { expire: 0 });
    return NextResponse.json({ result: data, variants: await inventoryRows() });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    console.error("admin_inventory_adjust_failed", sanitizedAdminError(error));
    const conflict = /conflict|55P03/.test(error instanceof Error ? error.message : "");
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível ajustar o estoque.") }, { status: conflict ? 409 : 400 });
  }
}
