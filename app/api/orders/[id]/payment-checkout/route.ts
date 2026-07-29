import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderRepository } from "@/repositories/order-repository";
import { createPagBankCheckoutForOrder } from "@/services/pagbank/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({
      scope: "payment-checkout",
      identifier: user.id,
      limit: 10,
      windowSeconds: 60 * 60,
    });
  } catch (error) {
    const response = validationErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "Não foi possível validar a solicitação." }, { status: 503 });
  }
  const { id } = await params;
  const visibleOrder = await orderRepository.findById(id);
  if (!visibleOrder) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  try {
    return NextResponse.json(await createPagBankCheckoutForOrder(id));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível criar o checkout PagBank.",
    }, { status: 400 });
  }
}
