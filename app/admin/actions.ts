"use server";

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin";
import { clientIpAddress } from "@/lib/security/client-ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function loginAdmin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/admin?erro=campos-obrigatorios");
  if (email.length > 254 || password.length > 128) redirect("/admin?erro=credenciais-invalidas");
  try {
    await enforceRateLimit({
      scope: "admin-login",
      identifier: `${await clientIpAddress()}:${email.toLowerCase()}`,
      limit: 8,
      windowSeconds: 15 * 60,
    });
  } catch {
    redirect("/admin?erro=muitas-tentativas");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect("/admin?erro=credenciais-invalidas");

  const { data: admin } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();
  if (!admin) {
    await supabase.auth.signOut();
    redirect("/admin?erro=acesso-negado");
  }
  redirect("/admin/dashboard");
}

export async function logoutAdmin() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin");
}

export async function requestAdminPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254) redirect("/admin?recuperacao=solicitada");
  try {
    await enforceRateLimit({
      scope: "admin-password-reset",
      identifier: `${await clientIpAddress()}:${email}`,
      limit: 3,
      windowSeconds: 60 * 60,
    });
  } catch {
    redirect("/admin?recuperacao=solicitada");
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent("/admin/redefinir-senha")}`,
  });
  redirect("/admin?recuperacao=solicitada");
}

export async function updateAdminPassword(formData: FormData) {
  const session = await getAdminSession();
  if (!session) redirect("/admin?erro=acesso-negado");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password !== confirmation) redirect("/admin/redefinir-senha?erro=senhas-diferentes");
  if (password.length < 12 || password.length > 128) {
    redirect("/admin/redefinir-senha?erro=senha-invalida");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/admin/redefinir-senha?erro=nao-atualizada");
  await supabase.auth.signOut();
  redirect("/admin?senha=alterada");
}
