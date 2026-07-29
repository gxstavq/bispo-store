import Link from "next/link";
import { Plus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminProductsManager } from "@/components/admin-products-manager";

export default function ProductsAdminPage() {
  return (
    <>
      <AdminPageHeader eyebrow="CATÁLOGO SUPABASE" title="Produtos." description="Edite, publique e organize o catálogo protegido por RLS." action={<Link href="/admin/produtos/novo" className="button button--red"><Plus size={18} /> Novo produto</Link>} />
      <AdminProductsManager />
    </>
  );
}
