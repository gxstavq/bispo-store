import { NextRequest, NextResponse } from "next/server";
import { humanAdminError, sanitizedAdminError } from "@/lib/admin-errors";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { readAdminHomeBanner, restoreHomeBanner, writeHomeBanner } from "@/repositories/home-banner-repository";
import type { HomeBannerSettings } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStorageImage(value: unknown, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return undefined;
  if (typeof value !== "string" || value.length > 2048) throw new Error("invalid_banner_image");
  const url = new URL(value);
  const expectedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local").host;
  if (url.protocol !== "https:" || url.host !== expectedHost || !url.pathname.startsWith("/storage/v1/object/public/product-images/")) {
    throw new Error("invalid_banner_image");
  }
  return url.toString();
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : "";
}

export async function GET() {
  await requireAdmin();
  return NextResponse.json(await readAdminHomeBanner(), { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  const { user } = await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<Partial<HomeBannerSettings>>(request, 16 * 1024);
    const link = clean(input.link, 2048);
    if (link && !link.startsWith("/") && !/^https:\/\//i.test(link)) throw new Error("invalid_banner_link");
    const banner: HomeBannerSettings = {
      desktopImageUrl: safeStorageImage(input.desktopImageUrl) ?? "",
      mobileImageUrl: safeStorageImage(input.mobileImageUrl, true),
      altText: clean(input.altText, 180),
      title: clean(input.title, 160) || undefined,
      link: link || undefined,
      active: input.active === true,
    };
    if (!banner.altText) return NextResponse.json({ error: "Informe o texto alternativo do banner." }, { status: 400 });
    return NextResponse.json({ banner: await writeHomeBanner(banner, user.id) });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;
    console.error("admin_home_banner_save_failed", sanitizedAdminError(error));
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível salvar o banner.") }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await requireAdmin();
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<{ action?: string }>(request, 4096);
    if (input.action !== "restore") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    return NextResponse.json({ banner: await restoreHomeBanner(user.id) });
  } catch (error) {
    console.error("admin_home_banner_restore_failed", sanitizedAdminError(error));
    return NextResponse.json({ error: humanAdminError(error, "Não foi possível restaurar o banner anterior.") }, { status: 400 });
  }
}
