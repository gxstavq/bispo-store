import { NextRequest, NextResponse } from "next/server";
import {
  isCnpjConfigured,
  readStoreSettings,
  writeStoreSettings,
} from "@/repositories/supabase-settings-repository";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import type { StoreSettings } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  return NextResponse.json({
    settings: await readStoreSettings(),
    cnpjConfigured: isCnpjConfigured(),
  });
}

export async function PUT(request: NextRequest) {
  const { user } = await requireAdmin();
  const current = await readStoreSettings();
  let input: Partial<StoreSettings>;
  try {
    assertSameOrigin(request);
    input = await readJsonBody<Partial<StoreSettings>>(request, 32 * 1024);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const limited = (value: unknown, max: number) =>
    typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : undefined;
  const settings = await writeStoreSettings({
    ...current,
    storeName: limited(input.storeName, 120) || current.storeName,
    ownerName: limited(input.ownerName, 120) || current.ownerName,
    originAddress: limited(input.originAddress, 250) || current.originAddress,
    originPostalCode: limited(input.originPostalCode, 16) || current.originPostalCode,
    whatsapp: input.whatsapp?.replace(/\D/g, "") || current.whatsapp,
    commercialEmail: limited(input.commercialEmail, 254) || current.commercialEmail,
    stateRegistration: limited(input.stateRegistration, 32) ?? current.stateRegistration,
    economicActivityCode: limited(input.economicActivityCode, 32) ?? current.economicActivityCode,
    fiscalNotes: limited(input.fiscalNotes, 2000) ?? current.fiscalNotes,
    originDistrict: limited(input.originDistrict, 120) ?? current.originDistrict,
    originCity: limited(input.originCity, 120) || current.originCity,
    originState: "SP",
    senderPhone: input.senderPhone?.replace(/\D/g, "") ?? current.senderPhone,
    cnpjEnvVar: "STORE_CNPJ",
  }, user.id);
  return NextResponse.json({ settings, cnpjConfigured: isCnpjConfigured() });
}
