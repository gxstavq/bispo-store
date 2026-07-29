import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const migrationId = "2026-07-27-commercial-rules-v2";
const root = process.cwd();
const productsFile = path.join(root, "data", "products.local.json");
const migrationFile = path.join(root, "data", "migrations.local.json");
const archivedAt = "2026-07-27T00:00:00.000Z";

const defaults = {
  tenis: { weightKg: 1.25, lengthCm: 33, widthCm: 20, heightCm: 12, packagingCategory: "caixa-tenis" },
  calcas: { weightKg: 0.6, lengthCm: 30, widthCm: 25, heightCm: 5, packagingCategory: "pacote-roupa" },
  conjuntos: { weightKg: 1.2, lengthCm: 40, widthCm: 30, heightCm: 12, packagingCategory: "caixa-conjunto" },
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

const applied = await readJson(migrationFile, []);
if (applied.some((entry) => entry.id === migrationId)) {
  console.log(`Migration ${migrationId} já aplicada.`);
  process.exit(0);
}

const products = await readJson(productsFile, []);
let archived = 0;
let migratedPants = 0;

const migrated = products.map((source) => {
  const isPants = source.category === "calcas-shorts"
    && source.name.toLocaleLowerCase("pt-BR").startsWith("calça");
  const category = isPants ? "calcas" : source.category;
  if (isPants) migratedPants += 1;

  const categoryDefaults = defaults[category];
  if (!categoryDefaults) {
    archived += 1;
    return {
      ...source,
      active: false,
      status: "inactive",
      shippingEnabled: false,
      archivedAt: source.archivedAt ?? archivedAt,
      archiveReason: source.archiveReason ?? "Categoria fora da operação comercial atual",
    };
  }

  return {
    ...source,
    category,
    weightKg: source.weightKg ?? categoryDefaults.weightKg,
    lengthCm: source.lengthCm ?? categoryDefaults.lengthCm,
    widthCm: source.widthCm ?? categoryDefaults.widthCm,
    heightCm: source.heightCm ?? categoryDefaults.heightCm,
    packagingCategory: source.packagingCategory ?? categoryDefaults.packagingCategory,
    shippingEnabled: source.shippingEnabled ?? true,
  };
});

await writeFile(productsFile, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
applied.push({
  id: migrationId,
  appliedAt: new Date().toISOString(),
  products: migrated.length,
  archived,
  migratedPants,
});
await writeFile(migrationFile, `${JSON.stringify(applied, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  migration: migrationId,
  products: migrated.length,
  archived,
  migratedPants,
}, null, 2));
