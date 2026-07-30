import { NextRequest, NextResponse } from "next/server";
import { verifyPagBankDiagnosticToken } from "@/lib/integrations/pagbank-diagnostic";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  consultPagBankCheckout,
  pagBankCheckoutTotalCents,
  type PagBankCheckout,
} from "@/services/pagbank/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SafeCheckoutResponse = PagBankCheckout & {
  redirect_url?: string;
  return_url?: string;
  notification_urls?: string[];
  payment_notification_urls?: string[];
  payment_methods?: Array<{ type?: string }>;
};

function safeReturnUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      origin: url.origin,
      pathname: url.pathname,
      orderNumber: url.searchParams.get("pedido"),
      hasSignedReturnToken: Boolean(url.searchParams.get("retorno")),
    };
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.CONTEXT !== "deploy-preview") {
    return NextResponse.json({ error: "Rota indisponível." }, { status: 404 });
  }
  const { id } = await params;
  if (!/^CHEC_[A-Z0-9-]{12,80}$/i.test(id)) {
    return NextResponse.json({ error: "Checkout inválido." }, { status: 400 });
  }
  if (!verifyPagBankDiagnosticToken(
    id,
    request.headers.get("x-bispo-diagnostic-timestamp"),
    request.headers.get("x-bispo-diagnostic-token"),
  )) {
    return NextResponse.json({ error: "Autorização diagnóstica inválida." }, { status: 401 });
  }
  try {
    await enforceRateLimit({
      scope: "pagbank-checkout-diagnostic",
      identifier: id,
      limit: 10,
      windowSeconds: 60 * 60,
    });
    const checkout = await consultPagBankCheckout(id) as SafeCheckoutResponse;
    return NextResponse.json({
      id: checkout.id,
      referenceId: checkout.reference_id ?? null,
      status: checkout.status ?? null,
      expirationDate: checkout.expiration_date ?? null,
      totalCents: pagBankCheckoutTotalCents(checkout),
      items: (checkout.items ?? []).map((item) => ({
        quantity: Number(item.quantity ?? 0),
        unitAmount: Number(item.unit_amount ?? 0),
      })),
      shipping: {
        type: checkout.shipping?.type ?? null,
        amount: Number(checkout.shipping?.amount ?? 0),
      },
      paymentStatuses: [
        ...(checkout.payments ?? []),
        ...(checkout.charges ?? []),
      ].map((payment) => ({
        status: typeof payment.status === "string" ? payment.status : null,
        method: payment.payment_method
          && typeof payment.payment_method === "object"
          && "type" in payment.payment_method
          ? String(payment.payment_method.type)
          : null,
      })),
      paymentMethods: (checkout.payment_methods ?? [])
        .map((method) => method.type)
        .filter((method): method is string => Boolean(method)),
      redirect: safeReturnUrl(checkout.redirect_url ?? checkout.return_url),
      notificationUrls: [
        ...(checkout.notification_urls ?? []),
        ...(checkout.payment_notification_urls ?? []),
      ],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({
      error: "Não foi possível consultar o Checkout Sandbox.",
    }, { status: 502 });
  }
}
