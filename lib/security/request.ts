import "server-only";

import { NextRequest, NextResponse } from "next/server";
export { safeInternalPath, safeJsonForHtml } from "./safe-values";

export class RequestValidationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowedOrigins = new Set([request.nextUrl.origin]);
  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSite) {
    try {
      allowedOrigins.add(new URL(configuredSite).origin);
    } catch {
      throw new RequestValidationError("Origem configurada inválida.", 500);
    }
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new RequestValidationError("Origem da requisição inválida.", 403);
  }
  if (!allowedOrigins.has(requestOrigin)) {
    throw new RequestValidationError("Origem da requisição não autorizada.", 403);
  }
}

export async function readJsonBody<T>(
  request: NextRequest,
  maxBytes = 64 * 1024,
): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestValidationError("Payload excede o limite permitido.", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new RequestValidationError("Payload excede o limite permitido.", 413);
  }
  if (!raw) throw new RequestValidationError("Payload JSON obrigatório.");

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RequestValidationError("Payload JSON inválido.");
  }
}

export function validationErrorResponse(error: unknown) {
  if (error instanceof RequestValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}
