import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function validImageSignature(type: string, bytes: Buffer) {
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (type === "image/webp") {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (type === "image/avif") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    return bytes.length >= 12
      && bytes.subarray(4, 8).toString("ascii") === "ftyp"
      && (brand === "avif" || brand === "avis");
  }
  return false;
}

export async function POST(request: NextRequest) {
  const { user } = await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 13 * 1024 * 1024) {
    return NextResponse.json({ error: "Upload excede o limite permitido." }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !EXTENSIONS[file.type]) {
    return NextResponse.json({ error: "Envie uma imagem JPG, PNG, WEBP ou AVIF." }, { status: 400 });
  }
  if (file.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 12 MB." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validImageSignature(file.type, bytes)) {
    return NextResponse.json({ error: "O conteúdo do arquivo não corresponde a uma imagem permitida." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const storagePath = `admin/${user.id}/${randomUUID()}.${EXTENSIONS[file.type]}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data } = supabase.storage.from("product-images").getPublicUrl(storagePath);
  return NextResponse.json({ path: data.publicUrl, storagePath });
}
