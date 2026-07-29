import assert from "node:assert/strict";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const email = "bispostorebr@hotmail.com";
const displayName = "Diogo";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configuração local obrigatória ausente: ${name}.`);
  return value;
}

if (process.argv.length > 2) {
  throw new Error("Este utilitário não aceita senha nem outros valores por argumento.");
}

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}
const [password = "", confirmation = ""] = input.replace(/^\uFEFF/, "").split(/\r?\n/);
if (!password || !confirmation) throw new Error("Informe e confirme a senha pelo prompt local.");
if (password !== confirmation) throw new Error("As senhas não coincidem. Nenhuma alteração foi realizada.");
if (password.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres.");
if (password.length > 128) throw new Error("A senha excede o limite de 128 caracteres.");

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

const { count: activeAdminCount, error: countError } = await supabase
  .from("admin_users")
  .select("user_id", { count: "exact", head: true })
  .eq("active", true);
if (countError) throw countError;
if ((activeAdminCount ?? 0) !== 0) {
  throw new Error("Já existe um administrador ativo. Nenhuma alteração foi realizada.");
}

let page = 1;
let existingUser = null;
while (!existingUser) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  existingUser = data.users.find((user) => user.email?.toLowerCase() === email) ?? null;
  if (existingUser || data.users.length < 1000) break;
  page += 1;
}
if (existingUser) {
  throw new Error("Este e-mail já existe no Supabase Auth. A senha não foi alterada.");
}

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: displayName },
});
if (createError || !created.user) {
  throw createError ?? new Error("O Supabase Auth não retornou o usuário criado.");
}

try {
  const { error: adminError } = await supabase.from("admin_users").insert({
    user_id: created.user.id,
    email,
    display_name: displayName,
    active: true,
  });
  if (adminError) throw adminError;

  const { data: verifiedAuth, error: authError } = await supabase.auth.admin.getUserById(created.user.id);
  if (authError) throw authError;
  assert.equal(verifiedAuth.user.email?.toLowerCase(), email);

  const { data: activeAdmins, error: verifyAdminError } = await supabase
    .from("admin_users")
    .select("user_id, email, display_name, active")
    .eq("active", true);
  if (verifyAdminError) throw verifyAdminError;
  assert.equal(activeAdmins.length, 1);
  assert.equal(activeAdmins[0].user_id, created.user.id);
  assert.equal(activeAdmins[0].email.toLowerCase(), email);
  assert.equal(activeAdmins[0].display_name, displayName);
  assert.equal(activeAdmins[0].active, true);

  console.log(JSON.stringify({
    created: true,
    authUserConfirmed: true,
    adminUserLinked: true,
    activeAdminCount: activeAdmins.length,
    userId: created.user.id,
    email,
    displayName,
  }, null, 2));
} catch (error) {
  await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
  throw error;
}
