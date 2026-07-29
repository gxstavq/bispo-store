import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const confirm = process.argv.includes("--confirm");
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || null;

if (!email) throw new Error("Defina ADMIN_EMAIL apenas no ambiente do terminal.");
if (!confirm) {
  console.log(`Prévia: promover o usuário Auth existente ${email} como administrador.`);
  console.log("Nenhuma alteração foi realizada. Repita com --confirm.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceRoleKey) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let page = 1;
let user;
while (!user) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (user || data.users.length < 1000) break;
  page += 1;
}
if (!user) {
  throw new Error("Usuário não encontrado no Supabase Auth. Crie-o primeiro no painel do Supabase; este script não inventa senha.");
}

const { error } = await supabase.from("admin_users").upsert({
  user_id: user.id,
  email,
  display_name: displayName,
  active: true,
}, { onConflict: "user_id" });
if (error) throw error;
console.log(`Administrador habilitado: ${email}. Nenhuma senha foi criada ou armazenada pelo projeto.`);
