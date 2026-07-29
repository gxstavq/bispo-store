import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import {
  printMelhorEnvioLabel,
  purchaseMelhorEnvioLabel,
  trackMelhorEnvioLabel,
} from "@/services/melhor-envio/label-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const { id } = await params;
  let input: {
    action?: "purchase" | "print" | "track";
    invoiceKey?: string;
  };
  try {
    input = await readJsonBody<typeof input>(request, 4096);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  if (input.invoiceKey && !/^\d{44}$/.test(input.invoiceKey)) {
    return NextResponse.json({ error: "A chave da nota fiscal deve conter 44 dígitos." }, { status: 400 });
  }
  try {
    if (input.action === "purchase") {
      return NextResponse.json(await purchaseMelhorEnvioLabel(id, user.id, input.invoiceKey ?? ""));
    }
    if (input.action === "print") {
      return NextResponse.json(await printMelhorEnvioLabel(id));
    }
    if (input.action === "track") {
      return NextResponse.json(await trackMelhorEnvioLabel(id));
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falha na operação de etiqueta.",
    }, { status: 400 });
  }
}
