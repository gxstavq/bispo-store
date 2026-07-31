import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  const { url, anonKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/orders/:path*",
    "/api/integrations/pagbank/:path*",
    "/api/integrations/melhor-envio/authorize",
    "/acompanhar-pedido",
    "/pedido-recebido",
    "/entrar",
    "/auth/callback",
  ],
};
