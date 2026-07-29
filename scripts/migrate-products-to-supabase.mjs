import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const sourceFile = path.join(root, "data", "products.local.json");
const publicRoot = path.resolve(root, "public");
const confirm = process.argv.includes("--confirm");
const overwriteExisting = process.argv.includes("--overwrite-existing");
const skipImages = process.argv.includes("--skip-images");

const defaults = {
  tenis: { weightKg: 1.25, lengthCm: 33, widthCm: 20, heightCm: 12, packagingCategory: "caixa-tenis" },
  calcas: { weightKg: 0.6, lengthCm: 30, widthCm: 25, heightCm: 5, packagingCategory: "pacote-roupa" },
  conjuntos: { weightKg: 1.2, lengthCm: 40, widthCm: 30, heightCm: 12, packagingCategory: "caixa-conjunto" },
};
const activeCategories = new Set(["tenis", "calcas", "conjuntos"]);
const contentTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function safePart(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = [
      "message" in error ? error.message : null,
      "details" in error ? error.details : null,
      "hint" in error ? error.hint : null,
      "code" in error ? `código ${error.code}` : null,
    ].filter(Boolean);
    if (details.length) return details.join(" | ");
  }
  return String(error);
}

function localImagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const resolved = path.resolve(publicRoot, value.replace(/^[/\\]+/, ""));
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Caminho de imagem fora de public/: ${value}`);
  }
  return resolved;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function variantRows(productId, product) {
  const sizes = [...new Set((product.sizes ?? []).map(String).filter(Boolean))];
  const colors = [...new Set((product.colors ?? []).map(String).filter(Boolean))];
  const combinations = sizes.flatMap((size) => colors.map((color) => ({ size, color })));
  const divisor = Math.max(1, combinations.length);
  const stock = Math.max(0, Number(product.stock) || 0);
  return combinations.map(({ size, color }, index) => {
    const digest = createHash("sha256").update(`${size}\0${color}`).digest("hex").slice(0, 8);
    return {
      product_id: productId,
      sku: `${safePart(product.code).toUpperCase()}-${digest.toUpperCase()}`,
      size,
      color,
      stock: Math.floor(stock / divisor) + (index < stock % divisor ? 1 : 0),
      active: true,
    };
  });
}

function productPayload(product, categoryId) {
  const categoryDefaults = defaults[product.category];
  const sellable = activeCategories.has(product.category);
  const sourceStatus = product.status ?? (product.active ? "active" : "inactive");
  const status = sellable
    ? (["active", "inactive", "draft"].includes(sourceStatus) ? sourceStatus : "inactive")
    : "archived";
  return {
    legacy_id: String(product.id),
    category_id: categoryId,
    name: String(product.name),
    slug: String(product.slug),
    code: String(product.code),
    description: String(product.description ?? ""),
    price: Number(product.price) || 0,
    promotional_price: product.promotionalPrice == null ? null : Number(product.promotionalPrice),
    weight_kg: product.weightKg ?? categoryDefaults?.weightKg ?? null,
    length_cm: product.lengthCm ?? categoryDefaults?.lengthCm ?? null,
    width_cm: product.widthCm ?? categoryDefaults?.widthCm ?? null,
    height_cm: product.heightCm ?? categoryDefaults?.heightCm ?? null,
    packaging_category: product.packagingCategory ?? categoryDefaults?.packagingCategory ?? "a-definir",
    shipping_enabled: sellable ? (product.shippingEnabled ?? true) : false,
    featured: Boolean(product.featured),
    is_new: Boolean(product.isNew),
    status,
    needs_review: product.needsReview ?? true,
    published_at: status === "active" ? new Date().toISOString() : null,
    deleted_at: null,
  };
}

const raw = await readFile(sourceFile, "utf8");
const products = JSON.parse(raw);
if (!Array.isArray(products)) throw new Error("data/products.local.json deve conter uma lista.");

const imageInventory = [];
const thumbnailInventory = [];
for (const product of products) {
  for (const image of product.images ?? []) {
    const file = localImagePath(image);
    if (file && await exists(file)) imageInventory.push({ productId: product.id, source: image, file });
  }
  for (const thumbnail of product.thumbnails ?? []) {
    const file = localImagePath(thumbnail);
    if (file && await exists(file)) thumbnailInventory.push({ productId: product.id, source: thumbnail, file });
  }
}

if (!confirm) {
  console.log(`Prévia segura: ${products.length} produtos, ${imageInventory.length} imagens e ${thumbnailInventory.length} miniaturas encontradas.`);
  console.log("Nenhuma alteração foi realizada.");
  console.log("Para migrar: npm run supabase:migrate:products -- --confirm");
  console.log("Para atualizar registros já migrados: acrescente --overwrite-existing.");
  process.exit(0);
}

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: categoryRows, error: categoryError } = await supabase.from("categories").select("id, slug");
if (categoryError) throw categoryError;
const categoryIds = new Map(categoryRows.map((row) => [row.slug, row.id]));

const result = { inserted: 0, resumed: 0, updated: 0, images: 0, variants: 0, skippedImages: 0, failures: [] };

for (const product of products) {
  try {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Categoria não existe no Supabase: ${product.category}`);
    const payload = productPayload(product, categoryId);
    const { data: existing, error: lookupError } = await supabase
      .from("products")
      .select("id")
      .eq("legacy_id", String(product.id))
      .maybeSingle();
    if (lookupError) throw lookupError;

    let productId;
    if (existing) {
      productId = existing.id;
      if (overwriteExisting) {
        const { error } = await supabase.from("products").update(payload).eq("id", productId);
        if (error) throw error;
        result.updated += 1;
      } else {
        result.resumed += 1;
      }
    } else {
      const { data: inserted, error } = await supabase.from("products").insert(payload).select("id").single();
      if (error) throw error;
      productId = inserted.id;
      result.inserted += 1;
    }

    if (!skipImages) {
      const { data: associated, error: associatedError } = await supabase
        .from("product_images")
        .select("storage_path")
        .eq("product_id", productId);
      if (associatedError) throw associatedError;
      const associatedPaths = new Set(associated.map((row) => row.storage_path));
      const validImages = [];
      for (const [position, image] of (product.images ?? []).entries()) {
        const file = localImagePath(image);
        if (!file || !await exists(file)) {
          result.skippedImages += 1;
          continue;
        }
        const extension = path.extname(file).toLowerCase();
        const storagePath = `catalog/${safePart(product.id)}/${String(position + 1).padStart(3, "0")}-${safePart(path.basename(file))}`;
        if (!associatedPaths.has(storagePath)) {
          const bytes = await readFile(file);
          const { error: uploadError } = await supabase.storage.from("product-images").upload(storagePath, bytes, {
            contentType: contentTypes[extension] ?? "application/octet-stream",
            cacheControl: "31536000",
            upsert: overwriteExisting,
          });
          if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
          const { data: publicData } = supabase.storage.from("product-images").getPublicUrl(storagePath);
          const thumbnailSource = product.thumbnails?.[position];
          const thumbnailFile = localImagePath(thumbnailSource);
          let thumbnailStoragePath = storagePath;
          let thumbnailPublicUrl = publicData.publicUrl;
          if (thumbnailFile && await exists(thumbnailFile)) {
            const thumbnailExtension = path.extname(thumbnailFile).toLowerCase();
            thumbnailStoragePath = `catalog/${safePart(product.id)}/thumbs/${String(position + 1).padStart(3, "0")}-${safePart(path.basename(thumbnailFile))}`;
            const { error: thumbnailUploadError } = await supabase.storage.from("product-images").upload(
              thumbnailStoragePath,
              await readFile(thumbnailFile),
              {
                contentType: contentTypes[thumbnailExtension] ?? "application/octet-stream",
                cacheControl: "31536000",
                upsert: overwriteExisting,
              },
            );
            if (thumbnailUploadError && !/already exists|duplicate/i.test(thumbnailUploadError.message)) {
              throw thumbnailUploadError;
            }
            thumbnailPublicUrl = supabase.storage.from("product-images").getPublicUrl(thumbnailStoragePath).data.publicUrl;
          }
          validImages.push({
            product_id: productId,
            storage_path: storagePath,
            public_url: publicData.publicUrl,
            thumbnail_storage_path: thumbnailStoragePath,
            thumbnail_public_url: thumbnailPublicUrl,
            alt_text: `${product.name} — imagem ${position + 1}`,
            position,
            is_cover: image === (product.coverImage ?? product.images?.[0]),
          });
        }
      }
      if (validImages.length) {
        const { error } = await supabase.from("product_images").insert(validImages);
        if (error) throw error;
        result.images += validImages.length;
      }
    }

    const { count, error: countError } = await supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);
    if (countError) throw countError;
    if (overwriteExisting && count) {
      const { error } = await supabase.from("product_variants").delete().eq("product_id", productId);
      if (error) throw error;
    }
    if (!count || overwriteExisting) {
      const variants = variantRows(productId, product);
      if (variants.length) {
        const { error } = await supabase.from("product_variants").insert(variants);
        if (error) throw error;
        result.variants += variants.length;
      }
    }
  } catch (error) {
    result.failures.push({
      legacyId: String(product.id),
      message: errorMessage(error),
    });
  }
}

console.log(JSON.stringify(result, null, 2));
if (result.failures.length) {
  console.error("Migração incompleta. O arquivo local foi preservado; corrija as falhas e execute novamente.");
  process.exitCode = 1;
} else {
  console.log("Migração concluída. O arquivo data/products.local.json foi preservado para conferência.");
}
