import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { isValidOrderNumber } from "@/lib/orders/order-number";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  assertSameOrigin,
  readJsonBody,
  validationErrorResponse,
} from "@/lib/security/request";
import {
  PagBankReconciliationError,
  reconcilePagBankDirectPayment,
} from "@/services/pagbank/reconciliation";
import { isPagBankOrderId } from "@/services/pagbank/provider-association";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: "Administrador não autenticado." },
      { status: 401 },
    );
  }

  let input: { providerOrderId?: unknown };
  try {
    assertSameOrigin(request);
    input = await readJsonBody<{ providerOrderId?: unknown }>(request, 2_048);
  } catch (error) {
    return validationErrorResponse(error)
      ?? NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { id } = await params;
  if (!isValidOrderNumber(id)) {
    return NextResponse.json({ error: "Número de pedido inválido." }, { status: 400 });
  }
  const providerOrderId = input.providerOrderId === undefined
    || input.providerOrderId === ""
    ? undefined
    : input.providerOrderId;
  if (providerOrderId !== undefined && !isPagBankOrderId(providerOrderId)) {
    return NextResponse.json(
      { error: "ID PagBank inválido. Use o formato ORDE_..." },
      { status: 400 },
    );
  }

  try {
    await enforceRateLimit({
      scope: "pagbank-admin-direct-reconciliation",
      identifier: session.user.id,
      limit: 20,
      windowSeconds: 60 * 60,
    });
    const result = await reconcilePagBankDirectPayment({
      orderNumber: id,
      providerOrderId,
      source: "admin_reconciliation",
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PagBankReconciliationError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
      }, { status: error.status });
    }
    return NextResponse.json({
      error: "Não foi possível consultar o pagamento no PagBank.",
    }, { status: 502 });
  }
}
