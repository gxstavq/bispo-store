import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("As variáveis do Supabase são obrigatórias para o backup.");
}

const requestedDirectory = process.argv[2];
const backupDirectory = path.resolve(
  requestedDirectory ?? path.join(".supabase-backups", new Date().toISOString().replaceAll(":", "-")),
);
const workspace = process.cwd();
const allowedRoot = path.resolve(workspace, ".supabase-backups");

if (
  backupDirectory !== allowedRoot
  && !backupDirectory.startsWith(`${allowedRoot}${path.sep}`)
) {
  throw new Error("O backup deve permanecer dentro de .supabase-backups.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tables = [
  "admin_users",
  "categories",
  "products",
  "product_images",
  "product_variants",
  "customers",
  "addresses",
  "orders",
  "order_items",
  "shipping_quotes",
  "shipping_decisions",
  "payments",
  "payment_events",
  "shipment_labels",
  "order_status_history",
  "store_settings",
  "audit_logs",
  "integration_errors",
  "integration_credentials",
  "oauth_states",
];

const manifest = {
  format: "bispo-store-supabase-application-backup-v1",
  createdAt: new Date().toISOString(),
  projectHost: new URL(supabaseUrl).host,
  tables: {},
  authUsers: 0,
  storage: {},
  files: {},
  notes: [
    "Backup lógico de dados da aplicação, metadados do Auth e objetos do Storage.",
    "Hashes/senhas do Supabase Auth não são expostos pela API administrativa.",
    "O esquema é preservado pelas migrations versionadas copiadas para este backup.",
  ],
};

async function writeJson(relativePath, value) {
  const destination = path.join(backupDirectory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(destination, contents, { encoding: "utf8", mode: 0o600 });
  manifest.files[relativePath.replaceAll("\\", "/")] = createHash("sha256")
    .update(contents)
    .digest("hex");
}

async function exportTable(table) {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Falha ao exportar a tabela ${table}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  await writeJson(path.join("database", `${table}.json`), rows);
  manifest.tables[table] = rows.length;
}

async function exportAuthUsers() {
  const users = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Falha ao exportar metadados do Auth: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  await writeJson(path.join("auth", "users.json"), users);
  manifest.authUsers = users.length;
}

function safeStorageSegment(segment) {
  if (
    !segment
    || segment === "."
    || segment === ".."
    || segment.includes("/")
    || segment.includes("\\")
  ) {
    throw new Error("O Storage retornou um caminho inseguro.");
  }
  return segment;
}

async function exportStorageFolder(bucketName, remoteFolder = "") {
  const exported = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucketName).list(remoteFolder, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Falha ao listar o bucket ${bucketName}: ${error.message}`);

    for (const item of data ?? []) {
      const name = safeStorageSegment(item.name);
      const remotePath = remoteFolder ? `${remoteFolder}/${name}` : name;

      if (!item.id && !item.metadata) {
        exported.push(...await exportStorageFolder(bucketName, remotePath));
        continue;
      }

      const { data: blob, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(remotePath);
      if (downloadError) {
        throw new Error(`Falha ao baixar ${bucketName}/${remotePath}: ${downloadError.message}`);
      }

      const bytes = Buffer.from(await blob.arrayBuffer());
      const relativePath = path.join("storage", bucketName, ...remotePath.split("/"));
      const destination = path.join(backupDirectory, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { mode: 0o600 });
      manifest.files[relativePath.replaceAll("\\", "/")] = createHash("sha256")
        .update(bytes)
        .digest("hex");
      exported.push({ path: remotePath, size: bytes.length });
    }

    if (!data || data.length < 1000) break;
  }

  return exported;
}

async function exportStorage() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Falha ao listar buckets: ${error.message}`);

  for (const bucket of buckets ?? []) {
    const objects = await exportStorageFolder(bucket.name);
    manifest.storage[bucket.name] = {
      id: bucket.id,
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit,
      allowedMimeTypes: bucket.allowed_mime_types,
      objects,
    };
  }
}

async function copyMigrations() {
  const source = path.join(workspace, "supabase", "migrations");
  const destination = path.join(backupDirectory, "schema", "migrations");
  await mkdir(destination, { recursive: true });

  for (const entry of await readdir(source)) {
    const sourceFile = path.join(source, entry);
    if ((await stat(sourceFile)).isFile() && entry.endsWith(".sql")) {
      await copyFile(sourceFile, path.join(destination, entry));
    }
  }
}

await mkdir(backupDirectory, { recursive: true, mode: 0o700 });

for (const table of tables) {
  await exportTable(table);
}
await exportAuthUsers();
await exportStorage();
await copyMigrations();
await writeJson("manifest.json", manifest);

const storageObjectCount = Object.values(manifest.storage)
  .reduce((total, bucket) => total + bucket.objects.length, 0);

console.log(`Backup concluído em ${backupDirectory}`);
console.log(`Tabelas exportadas: ${tables.length}`);
console.log(`Usuários Auth registrados: ${manifest.authUsers}`);
console.log(`Objetos Storage preservados: ${storageObjectCount}`);
