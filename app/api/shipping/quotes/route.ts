import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateCartItems } from "@/lib/validation/commerce";
import { createMelhorEnvioQuotes } from "@/services/shipping/quote-service";
import type { CartItem } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({
      error: "Entre com seu e-mail antes de consultar o frete.",
      loginRequired: true,
    }, { status: 401 });
  }
  let input: { postalCode?: string; items?: CartItem[] };
  try {
    assertSameOrigin(request);
    const raw = await readJsonBody<{ postalCode?: unknown; items?: unknown }>(request);
    const postalCode = String(raw.postalCode ?? "").replace(/\D/g, "");
    if (postalCode.length !== 8) {
      return NextResponse.json({ error: "Informe um CEP válido com 8 dígitos." }, { status: 400 });
    }
    input = { postalCode, items: validateCartItems(raw.items) };
    await enforceRateLimit({
      scope: "shipping-quote",
      identifier: user.id,
      limit: 20,
      windowSeconds: 10 * 60,
    });
  } catch (error) {
    const response = validationErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "Não foi possível validar a cotação." }, { status: 503 });
  }
  if (!input.postalCode || !input.items?.length) {
    return NextResponse.json({ error: "CEP e carrinho são obrigatórios." }, { status: 400 });
  }
  try {
    const quotes = await createMelhorEnvioQuotes({
      userId: user.id,
      destinationPostalCode: input.postalCode,
      items: input.items,
    });
    return NextResponse.json({ quotes });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível calcular o frete.",
    }, { status: 502 });
  }
}
