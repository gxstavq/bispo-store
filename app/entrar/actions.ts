"use server";

import { redirect } from "next/navigation";
import { clientIpAddress } from "@/lib/security/client-ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { safeInternalPath } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requestCustomerMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeInternalPath(String(formData.get("next") ?? ""), "/checkout");
  const resultUrl = `/entrar?next=${encodeURIComponent(next)}&envio=1`;
  if (
    email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    redirect(resultUrl);
  }
  try {
    await enforceRateLimit({
      scope: "customer-magic-link",
      identifier: `${await clientIpAddress()}:${email}`,
      limit: 5,
      windowSeconds: 60 * 60,
    });
  } catch {
    redirect(resultUrl);
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });
  redirect(resultUrl);
}
