import { NextRequest, NextResponse } from "next/server";
import { clientIpAddress } from "@/lib/security/client-ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validationErrorResponse } from "@/lib/security/request";
import {
  lookupPostalAddress,
  normalizePostalCode,
  PostalCodeLookupError,
} from "@/services/address/viacep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const postalCode = normalizePostalCode(request.nextUrl.searchParams.get("postalCode") ?? "");
  if (postalCode.length !== 8) {
    return NextResponse.json(
      { error: "Informe um CEP válido com 8 dígitos." },
      { status: 400 },
    );
  }

  try {
    await enforceRateLimit({
      scope: "postal-code-lookup",
      identifier: await clientIpAddress(),
      limit: 30,
      windowSeconds: 10 * 60,
    });
    const address = await lookupPostalAddress(postalCode);
    return NextResponse.json(address, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof PostalCodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const validationResponse = validationErrorResponse(error);
    if (validationResponse) return validationResponse;
    return NextResponse.json(
      { error: "Não foi possível consultar o CEP agora. Tente novamente em instantes." },
      { status: 503 },
    );
  }
}
