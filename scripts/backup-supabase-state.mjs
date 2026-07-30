import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

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
  "inventory_reservations",
  "shipment_labels",
  "order_status_history",
  "store_settings",
  "audit_logs",
  "integration_errors",
  "integration_credentials",
  "oauth_states",
];
const optionalTables = new Set(["inventory_reservations"]);

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
      if (
        optionalTables.has(table)
        && (error.code === "42P01" || error.code === "PGRST205")
      ) {
        manifest.tables[table] = null;
        return;
      }
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

      const relativePath = path.join("storage", bucketName, ...remotePath.split("/"));
      const destination = path.join(backupDirectory, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      let storedBytes;
      try {
        const existing = await stat(destination);
        const remoteSize = Number(item.metadata?.size);
        if (Number.isFinite(remoteSize) && existing.size === remoteSize) {
          storedBytes = await readFile(destination);
        }
      } catch {}
      if (!storedBytes) {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(bucketName)
          .download(remotePath);
        if (downloadError) {
          throw new Error(`Falha ao baixar ${bucketName}/${remotePath}: ${downloadError.message}`);
        }
        storedBytes = Buffer.from(await blob.arrayBuffer());
        await writeFile(destination, storedBytes, { mode: 0o600 });
      }
      manifest.files[relativePath.replaceAll("\\", "/")] = createHash("sha256")
        .update(storedBytes)
        .digest("hex");
      exported.push({ path: remotePath, size: storedBytes.length });
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
      const destinationFile = path.join(destination, entry);
      await copyFile(sourceFile, destinationFile);
      const contents = await readFile(destinationFile);
      manifest.files[path.join("schema", "migrations", entry).replaceAll("\\", "/")] =
        createHash("sha256").update(contents).digest("hex");
    }
  }
}

async function exportAppliedMigrations() {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const { stdout } = await execFileAsync(
    executable,
    ["--yes", "supabase@latest", "migration", "list", "--linked"],
    {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: process.platform === "win32",
    },
  );
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("O Supabase CLI não retornou o histórico de migrations em JSON.");
  }
  const parsed = JSON.parse(stdout.slice(jsonStart));
  const applied = (parsed.migrations ?? [])
    .filter((migration) => migration.remote)
    .map(({ remote, time }) => ({ version: remote, appliedAt: time }));
  await writeJson(path.join("schema", "applied-migrations.json"), applied);
  manifest.appliedMigrations = applied.length;
}

async function listFilesRecursively(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(path.join(directory, entry.name), relativePath));
    } else if (
      entry.name !== "SHA256SUMS.txt"
      && !entry.name.startsWith("backup-progress.")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

async function writeChecksumFile() {
  const files = (await listFilesRecursively(backupDirectory))
    .sort((left, right) => left.localeCompare(right));
  const lines = [];
  for (const relativePath of files) {
    const contents = await readFile(path.join(backupDirectory, relativePath));
    const digest = createHash("sha256").update(contents).digest("hex");
    lines.push(`${digest}  ${relativePath.replaceAll("\\", "/")}`);
  }
  await writeFile(
    path.join(backupDirectory, "SHA256SUMS.txt"),
    `${lines.join("\n")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

await mkdir(backupDirectory, { recursive: true, mode: 0o700 });

for (const table of tables) {
  await exportTable(table);
}
await exportAuthUsers();
await exportStorage();
await copyMigrations();
await exportAppliedMigrations();
await writeJson("manifest.json", manifest);
await writeChecksumFile();

const storageObjectCount = Object.values(manifest.storage)
  .reduce((total, bucket) => total + bucket.objects.length, 0);

console.log(`Backup concluído em ${backupDirectory}`);
console.log(`Tabelas exportadas: ${tables.length}`);
console.log(`Usuários Auth registrados: ${manifest.authUsers}`);
console.log(`Objetos Storage preservados: ${storageObjectCount}`);
