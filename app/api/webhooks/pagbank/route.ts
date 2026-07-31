import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getPagBankConfig,
  getPagBankEnvironment,
} from "@/lib/integrations/config";
import {
  PagBankReconciliationError,
  reconcilePagBankOrderPayment,
  reconcilePagBankPayment,
} from "@/services/pagbank/reconciliation";
import { pagBankWebhookIdentifiers } from "@/services/pagbank/webhook-association";
import { validatePagBankWebhookSignature } from "@/services/pagbank/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  receivedSignatureLength?: number;
  calculatedSignatureLength?: number;
  bodySha256?: string;
};

function observeWebhook(input: Observation) {
  // Netlify preserva stderr em logs de Functions. O registro contém somente
  // metadados técnicos e nunca o corpo, a assinatura ou o token.
  console.error(JSON.stringify({
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
    received_signature_length: input.receivedSignatureLength,
    calculated_signature_length: input.calculatedSignatureLength,
    body_sha256: input.bodySha256,
    environment: (() => {
      try {
        return getPagBankEnvironment().environment;
      } catch {
        return "invalid";
      }
    })(),
  }));
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const signatureHeader = request.headers.get("x-authenticity-token");
  const signaturePresent = Boolean(signatureHeader);
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
    receivedSignatureLength: signatureHeader?.length ?? 0,
  });

  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > 262_144) {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "declared_payload_too_large",
      signaturePresent,
      receivedSignatureLength: signatureHeader?.length ?? 0,
    });
    return NextResponse.json({ error: "Payload inválido." }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  const bodyBytes = rawBody.byteLength;
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  observeWebhook({
    requestId,
    phase: "body_read",
    bodyBytes,
    bodySha256,
    signaturePresent,
    receivedSignatureLength: signatureHeader?.length ?? 0,
  });
  if (!bodyBytes || bodyBytes > 262_144) {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: bodyBytes ? "payload_too_large" : "empty_payload",
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureHeader?.length ?? 0,
    });
    return NextResponse.json({ error: "Payload inválido." }, {
      status: bodyBytes ? 413 : 400,
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
      reason: "pagbank_configuration_unavailable",
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureHeader?.length ?? 0,
    });
    return NextResponse.json({ error: "Webhook indisponível." }, { status: 503 });
  }

  const signatureValidation = validatePagBankWebhookSignature(
    rawBody,
    signatureHeader,
    pagBankToken,
  );
  pagBankToken = "";
  if (!signatureValidation.valid) {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: signatureValidation.reason,
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureValidation.receivedLength,
      calculatedSignatureLength: signatureValidation.calculatedLength,
    });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "invalid_json",
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureValidation.receivedLength,
      calculatedSignatureLength: signatureValidation.calculatedLength,
    });
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  let identifiers: ReturnType<typeof pagBankWebhookIdentifiers>;
  try {
    identifiers = pagBankWebhookIdentifiers(body);
  } catch {
    observeWebhook({
      requestId,
      phase: "validation",
      result: "rejected",
      reason: "missing_or_unsafe_identifier",
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureValidation.receivedLength,
      calculatedSignatureLength: signatureValidation.calculatedLength,
    });
    return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
  }

  try {
    const result = identifiers.providerOrderId
      ? await reconcilePagBankOrderPayment({
        providerOrderId: identifiers.providerOrderId,
        chargeId: identifiers.chargeId,
        orderNumber: identifiers.referenceId!,
        source: "webhook",
        applyNonPaid: true,
      })
      : await reconcilePagBankPayment({
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
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureValidation.receivedLength,
      calculatedSignatureLength: signatureValidation.calculatedLength,
    });
    return NextResponse.json({
      received: true,
      verified: true,
      duplicate: result.duplicate,
    });
  } catch (error) {
    const inProgress = error instanceof PagBankReconciliationError
      && error.code === "reconciliation_in_progress";
    if (inProgress) {
      observeWebhook({
        requestId,
        phase: "validation",
        result: "duplicate",
        reason: "official_state_processing",
        bodyBytes,
        bodySha256,
        signaturePresent,
        receivedSignatureLength: signatureValidation.receivedLength,
        calculatedSignatureLength: signatureValidation.calculatedLength,
      });
      return NextResponse.json({
        received: true,
        verified: true,
        duplicate: true,
        processing: true,
      });
    }

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
      bodyBytes,
      bodySha256,
      signaturePresent,
      receivedSignatureLength: signatureValidation.receivedLength,
      calculatedSignatureLength: signatureValidation.calculatedLength,
    });
    return NextResponse.json({
      error: status === 409
        ? "Pedido, referência ou valor divergente."
        : "Não foi possível verificar a notificação.",
    }, { status });
  }
}
