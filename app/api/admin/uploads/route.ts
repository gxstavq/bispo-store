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

type ProductImageRow = {
  product_id: string;
  storage_path: string;
  public_url: string;
  thumbnail_public_url: string | null;
};

export async function GET() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data: associations, error: associationsError } = await supabase
    .from("product_images")
    .select("product_id, storage_path, public_url, thumbnail_public_url")
    .order("storage_path", { ascending: true });
  if (associationsError) {
    return NextResponse.json({ error: "Não foi possível carregar o álbum de imagens." }, { status: 500 });
  }

  const album = new Map<string, {
    storagePath: string;
    url: string;
    thumbnailUrl: string;
    productIds: Set<string>;
  }>();
  for (const row of (associations ?? []) as ProductImageRow[]) {
    const current = album.get(row.storage_path);
    if (current) {
      current.productIds.add(row.product_id);
    } else {
      album.set(row.storage_path, {
        storagePath: row.storage_path,
        url: row.public_url,
        thumbnailUrl: row.thumbnail_public_url ?? row.public_url,
        productIds: new Set([row.product_id]),
      });
    }
  }

  async function listFolder(folder = ""): Promise<string[]> {
    const paths: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: files, error: listError } = await supabase.storage.from("product-images")
        .list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (listError) throw listError;
      for (const file of files ?? []) {
        const path = folder ? `${folder}/${file.name}` : file.name;
        if (!file.id && !file.metadata) paths.push(...await listFolder(path));
        else if (/\.(?:jpe?g|png|webp|avif)$/iu.test(file.name)) paths.push(path);
      }
      if (!files || files.length < 1000) break;
    }
    return paths;
  }
  let storageFiles: string[];
  try {
    storageFiles = await listFolder();
  } catch {
    return NextResponse.json({ error: "Não foi possível listar o álbum Fotos Bispo Store." }, { status: 500 });
  }
  for (const storagePath of storageFiles) {
    if (album.has(storagePath)) continue;
    const { data } = supabase.storage.from("product-images").getPublicUrl(storagePath);
    album.set(storagePath, {
      storagePath,
      url: data.publicUrl,
      thumbnailUrl: data.publicUrl,
      productIds: new Set(),
    });
  }

  return NextResponse.json({
    images: [...album.values()].map((image) => ({
      storagePath: image.storagePath,
      url: image.url,
      thumbnailUrl: image.thumbnailUrl,
      associationCount: image.productIds.size,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

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
  return NextResponse.json({ path: data.publicUrl, thumbnailUrl: data.publicUrl, storagePath });
}
