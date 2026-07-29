import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAdminSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: admin } = await supabase
    .from("admin_users")
    .select("user_id, email, display_name, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return admin ? { user, admin } : null;
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) redirect("/admin?erro=acesso-negado");
  return session;
}
