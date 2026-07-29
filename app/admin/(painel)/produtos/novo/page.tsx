import { AdminPageHeader } from "@/components/admin-page-header";
import { ProductFormDemo } from "@/components/product-form-demo";

export default function NewProductPage() {
  return <><AdminPageHeader eyebrow="CATÁLOGO / NOVO" title="Novo produto." description="Cadastre no Supabase um produto, suas variantes e imagens." /><ProductFormDemo /></>;
}
