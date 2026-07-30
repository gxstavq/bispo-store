import { NextRequest, NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/security/request";
import { claimGuestCheckoutOrders } from "@/lib/auth/customer-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), "/");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        try {
          await claimGuestCheckoutOrders(user);
        } catch {
          return NextResponse.redirect(new URL("/entrar?erro=vinculacao", request.url));
        }
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/entrar?erro=callback", request.url));
}
