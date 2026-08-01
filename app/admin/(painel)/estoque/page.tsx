import { AdminPageHeader } from "@/components/admin-page-header";
import { InventoryManager } from "@/components/inventory-manager";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function StockPage() {
  const db = await createSupabaseServerClient();
  const { data } = await db.from("product_variants").select("id,sku,size,color,stock,active,products!inner(id,name,code,status)").order("updated_at", { ascending: false });
  const variants = (data ?? []).map((row) => ({ ...row, product: Array.isArray(row.products) ? row.products[0] : row.products }));
  const total = variants.reduce((sum, variant) => sum + variant.stock, 0);
  return (
    <>
      <AdminPageHeader eyebrow="INVENTÁRIO" title="Estoque." description={`${total} unidades distribuídas em ${variants.length} variantes.`} />
      <InventoryManager initial={variants} />
    </>
  );
}
