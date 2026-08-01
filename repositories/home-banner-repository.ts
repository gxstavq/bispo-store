import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HomeBannerSettings } from "@/types/commerce";

const DEFAULT_HOME_BANNER: HomeBannerSettings = {
  desktopImageUrl: "",
  altText: "",
  active: false,
};

function parse(value: unknown): HomeBannerSettings | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.desktopImageUrl !== "string" || typeof input.altText !== "string") return null;
  return {
    desktopImageUrl: input.desktopImageUrl,
    mobileImageUrl: typeof input.mobileImageUrl === "string" ? input.mobileImageUrl : undefined,
    altText: input.altText,
    title: typeof input.title === "string" ? input.title : undefined,
    link: typeof input.link === "string" ? input.link : undefined,
    active: input.active === true,
  };
}

const cachedPublicHomeBanner = unstable_cache(async () => {
  const db = createSupabaseServiceClient();
  const { data } = await db.from("store_settings").select("home_banner").eq("singleton", true).maybeSingle();
  return parse(data?.home_banner);
}, ["home-banner-v1"], { revalidate: 60, tags: ["home-banner"] });

export async function readPublicHomeBanner() {
  return cachedPublicHomeBanner();
}

export async function readAdminHomeBanner() {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("store_settings")
    .select("home_banner,previous_home_banner").eq("singleton", true).single();
  if (error) throw new Error(error.message);
  const current = parse(data.home_banner);
  const previous = parse(data.previous_home_banner)
    ?? (current ? DEFAULT_HOME_BANNER : null);
  return { current, previous };
}

export async function writeHomeBanner(input: HomeBannerSettings, userId: string) {
  const db = await createSupabaseServerClient();
  const { data: current, error: readError } = await db.from("store_settings")
    .select("home_banner").eq("singleton", true).single();
  if (readError) throw new Error(readError.message);
  const { error } = await db.from("store_settings").update({
    previous_home_banner: parse(current.home_banner) ?? DEFAULT_HOME_BANNER,
    home_banner: input,
    updated_by: userId,
  }).eq("singleton", true);
  if (error) throw new Error(error.message);
  revalidateTag("home-banner", { expire: 0 });
  return input;
}

export async function restoreHomeBanner(userId: string) {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("store_settings")
    .select("home_banner,previous_home_banner").eq("singleton", true).single();
  if (error) throw new Error(error.message);
  const current = parse(data.home_banner);
  const previous = parse(data.previous_home_banner)
    ?? (current ? DEFAULT_HOME_BANNER : null);
  if (!previous) throw new Error("Não existe um banner anterior para restaurar.");
  const { error: updateError } = await db.from("store_settings").update({
    home_banner: data.previous_home_banner,
    previous_home_banner: data.home_banner,
    updated_by: userId,
  }).eq("singleton", true);
  if (updateError) throw new Error(updateError.message);
  revalidateTag("home-banner", { expire: 0 });
  return previous;
}
