import "server-only";

import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProductCategoryRecord } from "@/types/commerce";

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  active: boolean;
  sort_order: number;
};

const select = "id,slug,name,description,image_url,active,sort_order";

function map(row: CategoryRow): ProductCategoryRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    imageUrl: row.image_url ?? undefined,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

export async function fetchCategories(includeInactive = false) {
  const db = await createSupabaseServerClient();
  let query = db.from("categories").select(select).order("sort_order").order("name");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as CategoryRow[]).map(map);
}

const cachedPublicCategories = unstable_cache(async () => {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from("categories")
    .select(select)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) return [];
  return (data as CategoryRow[]).map(map);
}, ["public-categories-v1"], { revalidate: 60, tags: ["public-categories"] });

export async function fetchPublicCategories() {
  return cachedPublicCategories();
}
