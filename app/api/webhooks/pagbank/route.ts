import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPagBankConfig } from "@/lib/integrations/config";
import {
  PagBankReconciliationError,
  reconcilePagBankPayment,
} from "@/services/pagbank/reconciliation";
import { pagBankWebhookIdentifiers } from "@/services/pagbank/webhook-association";
import { verifyPagBankWebhookSignature } from "@/services/pagbank/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookBody = {
  checkout_id?: string;
  reference_id?: string;
};

type Observation = {
  requestId: string;
  phase: "received" | "body_read" | "validation";
  result?: "accepted" | "rejected" | "duplicate";
  reason?: string;
  receivedAt?: string;
  method?: string;
  declaredBodyBytes?: number | null;
  bodyBytes?: number;
  signaturePresent?: boolean;
  bodySha256?: string;
};

function observeWebhook(input: Observation) {
  const entry = JSON.stringify({
    event: "pagbank_webhook_observation",
    request_id: input.requestId,
    phase: input.phase,
    result: input.result,
    reason: input.reason,
    received_at: input.receivedAt,
    method: input.method,
    declared_body_bytes: input.declaredBodyBytes,
    body_bytes: input.bodyBytes,
    signature_present: input.signaturePresent,
    body_sha256: input.bodySha256,
  });
  if (input.result === "rejected") console.warn(entry);
  else console.info(entry);
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const signaturePresent = Boolean(request.headers.get("x-authenticity-token"));
  const declaredLengthValue = request.headers.get("content-length");
  const declaredLength = declaredLengthValue === null
    ? null
    : Number(declaredLengthValue);
  observeWebhook({
    requestId,
    phase: "received",
    receivedAt,
    method: request.method,
    declaredBodyBytes: Number.isFinite(declaredLength) ? declaredLength : null,
    signaturePresent,
  });

  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > 262_144) {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "declared_payload_too_large",
    });
    return NextResponse.json({ error: "Payload inválido." }, { status: 413 });
  }

  const rawBody = await request.text();
  const bodyBytes = Buffer.byteLength(rawBody, "utf8");
  const bodySha256 = createHash("sha256").update(rawBody, "utf8").digest("hex");
  observeWebhook({
    requestId,
    phase: "body_read",
    bodyBytes,
    bodySha256,
    signaturePresent,
  });
  if (!rawBody || bodyBytes > 262_144) {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: rawBody ? "payload_too_large" : "empty_payload",
    });
    return NextResponse.json({ error: "Payload inválido." }, {
      status: rawBody ? 413 : 400,
    });
  }

  let pagBankToken: string;
  try {
    pagBankToken = getPagBankConfig().token;
  } catch {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "sandbox_configuration_unavailable",
    });
    return NextResponse.json({ error: "Webhook indisponível." }, { status: 503 });
  }
  if (!verifyPagBankWebhookSignature(
    rawBody,
    request.headers.get("x-authenticity-token"),
    pagBankToken,
  )) {
    pagBankToken = "";
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: signaturePresent ? "invalid_signature" : "missing_signature",
    });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  pagBankToken = "";

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "invalid_json",
    });
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  let identifiers: ReturnType<typeof pagBankWebhookIdentifiers>;
  try {
    identifiers = pagBankWebhookIdentifiers(body as Record<string, unknown>);
  } catch {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "missing_identifier",
    });
    return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
  }

  try {
    const result = await reconcilePagBankPayment({
      checkoutId: identifiers.checkoutId,
      orderNumber: identifiers.referenceId,
      source: "webhook",
      applyNonPaid: true,
    });
    observeWebhook({
      requestId,
      phase: "validation",
      result: result.duplicate ? "duplicate" : "accepted",
      reason: result.duplicate ? "official_state_already_processed" : "official_state_verified",
    });
    return NextResponse.json({
      received: true,
      verified: true,
      duplicate: result.duplicate,
    });
  } catch (error) {
    const status = error instanceof PagBankReconciliationError
      ? error.status
      : 502;
    const reason = error instanceof PagBankReconciliationError
      ? error.code
      : "official_verification_failed";
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason,
    });
    return NextResponse.json({
      error: status === 409
        ? "Checkout, referência ou valor divergente."
        : "Não foi possível verificar a notificação.",
    }, { status });
  }
}
