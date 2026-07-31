import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  assertSameOrigin,
  validationErrorResponse,
} from "@/lib/security/request";
import {
  PagBankReconciliationError,
  reconcilePagBankPayment,
} from "@/services/pagbank/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Administrador não autenticado." }, { status: 401 });
  }
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }

  const { id } = await params;
  if (!/^CHEC_[A-Z0-9-]{12,80}$/i.test(id)) {
    return NextResponse.json({ error: "Checkout inválido." }, { status: 400 });
  }
  try {
    await enforceRateLimit({
      scope: "pagbank-admin-reconciliation",
      identifier: session.user.id,
      limit: 20,
      windowSeconds: 60 * 60,
    });
    const result = await reconcilePagBankPayment({
      checkoutId: id,
      source: "admin_reconciliation",
      applyNonPaid: false,
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
      error: "Não foi possível consultar o Checkout PagBank.",
    }, { status: 502 });
  }
}
