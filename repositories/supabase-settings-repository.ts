import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StoreSettings } from "@/types/commerce";

export async function readStoreSettings(): Promise<StoreSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_settings")
    .select("store_name, owner_name, origin_address, origin_postal_code, whatsapp, commercial_email, state_registration, economic_activity_code, fiscal_notes, origin_district, origin_city, origin_state, sender_phone")
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Configurações não encontradas.");
  return {
    storeName: data.store_name,
    ownerName: data.owner_name,
    originAddress: data.origin_address,
    originPostalCode: data.origin_postal_code,
    whatsapp: data.whatsapp,
    commercialEmail: data.commercial_email,
    stateRegistration: data.state_registration ?? "",
    economicActivityCode: data.economic_activity_code ?? "",
    fiscalNotes: data.fiscal_notes ?? "",
    originDistrict: data.origin_district ?? "",
    originCity: data.origin_city ?? "São Paulo",
    originState: data.origin_state ?? "SP",
    senderPhone: data.sender_phone ?? data.whatsapp,
    cnpjEnvVar: "STORE_CNPJ",
  };
}

export async function writeStoreSettings(input: StoreSettings, userId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("store_settings").update({
    store_name: input.storeName,
    owner_name: input.ownerName,
    origin_address: input.originAddress,
    origin_postal_code: input.originPostalCode,
    whatsapp: input.whatsapp,
    commercial_email: input.commercialEmail,
    state_registration: input.stateRegistration || null,
    economic_activity_code: input.economicActivityCode || null,
    fiscal_notes: input.fiscalNotes || null,
    origin_district: input.originDistrict || null,
    origin_city: input.originCity,
    origin_state: "SP",
    sender_phone: input.senderPhone || null,
    updated_by: userId,
  }).eq("singleton", true);
  if (error) throw new Error(error.message);
  return readStoreSettings();
}

export function isCnpjConfigured() {
  return Boolean(process.env.STORE_CNPJ?.trim());
}
