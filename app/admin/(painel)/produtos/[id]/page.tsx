import { AdminPageHeader } from "@/components/admin-page-header";
import { ProductFormDemo } from "@/components/product-form-demo";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product] = await fetchProducts({ includeInactive: true, id });
  return (
    <>
      <AdminPageHeader
        eyebrow="CATÁLOGO / EDITAR"
        title={product?.name ?? "Produto"}
        description="Alterações salvas no Supabase com proteção por RLS e auditoria."
      />
      <ProductFormDemo productId={id} />
    </>
  );
}
