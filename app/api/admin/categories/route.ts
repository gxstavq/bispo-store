import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { humanAdminError, sanitizedAdminError } from "@/lib/admin-errors";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchCategories } from "@/repositories/category-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : "";
}

function cleanSlug(value: unknown) {
  return cleanText(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cleanImageUrl(value: unknown) {
  const input = cleanText(value, 2048);
  if (!input) return null;
  const url = new URL(input);
  const expectedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local").host;
  if (url.protocol !== "https:" || url.host !== expectedHost
    || !url.pathname.startsWith("/storage/v1/object/public/product-images/")) {
    throw new Error("invalid_category_image");
  }
  return url.toString();
}

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ categories: await fetchCategories(true) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
    const name = cleanText(input.name, 100);
    const slug = cleanSlug(input.slug || name);
    if (name.length < 2 || slug.length < 2) {
      return NextResponse.json({ error: "Informe um nome e um slug válidos." }, { status: 400 });
    }
    const db = await createSupabaseServerClient();
    const { data, error } = await db.from("categories").insert({
      name,
      slug,
      description: cleanText(input.description, 500) || null,
      image_url: cleanImageUrl(input.imageUrl),
      active: input.active !== false,
      sort_order: Math.max(0, Math.min(9999, Number(input.sortOrder) || 0)),
      archived_at: input.active === false ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) throw error;
    revalidateTag("public-products", { expire: 0 });
    revalidateTag("public-categories", { expire: 0 });
    return NextResponse.json({ id: data.id, categories: await fetchCategories(true) }, { status: 201 });
  } catch (error) {
    console.error("admin_category_create_failed", sanitizedAdminError(error));
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível criar a categoria.") }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
    const id = cleanText(input.id, 80);
    const name = cleanText(input.name, 100);
    const slug = cleanSlug(input.slug || name);
    if (!id || name.length < 2 || slug.length < 2) {
      return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
    }
    const active = input.active !== false;
    const db = await createSupabaseServerClient();
    const { error } = await db.from("categories").update({
      name,
      slug,
      description: cleanText(input.description, 500) || null,
      image_url: cleanImageUrl(input.imageUrl),
      active,
      sort_order: Math.max(0, Math.min(9999, Number(input.sortOrder) || 0)),
      archived_at: active ? null : new Date().toISOString(),
    }).eq("id", id);
    if (error) throw error;
    revalidateTag("public-products", { expire: 0 });
    revalidateTag("public-categories", { expire: 0 });
    return NextResponse.json({ categories: await fetchCategories(true) });
  } catch (error) {
    console.error("admin_category_update_failed", sanitizedAdminError(error));
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível salvar a categoria.") }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<Record<string, unknown>>(request, 8192);
    const id = cleanText(input.id, 80);
    const replacementId = cleanText(input.replacementId, 80) || null;
    const db = await createSupabaseServerClient();
    const { data, error } = await db.rpc("delete_or_archive_category", {
      target_category_id: id,
      replacement_category_id: replacementId,
    });
    if (error) throw error;
    revalidateTag("public-products", { expire: 0 });
    revalidateTag("public-categories", { expire: 0 });
    return NextResponse.json({ result: data, categories: await fetchCategories(true) });
  } catch (error) {
    console.error("admin_category_delete_failed", sanitizedAdminError(error));
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível excluir ou arquivar a categoria.") }, { status: 400 });
  }
}
