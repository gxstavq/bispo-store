import { Archive, FolderTree, Pencil } from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { archivedCategoryLabels, publicCategoryLabels } from "@/lib/product-rules";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export default async function CategoriesPage() {
  const products = await fetchProducts({ includeInactive: true });
  return (
    <>
      <AdminPageHeader eyebrow="ORGANIZAÇÃO" title="Categorias." description="Somente Tênis, Calças e Conjuntos estão disponíveis no catálogo público." />
      <div className="category-admin-grid">
        {Object.entries(publicCategoryLabels).map(([key, label], index) => (
          <article className="admin-panel category-admin-card" key={key}>
            <div><span><FolderTree /></span><small>0{index + 1}</small></div>
            <h2>{label}</h2>
            <p>{products.filter((product) => product.category === key && product.active).length} produtos ativos</p>
            <div><span className="status-badge">Ativa</span><button aria-label={`Editar ${label}`}><Pencil size={17} /></button></div>
          </article>
        ))}
      </div>
      <section className="admin-panel archived-categories">
        <div className="admin-panel__header"><div><span>PRESERVAÇÃO DE DADOS</span><h2>Categorias arquivadas</h2></div><Archive /></div>
        <p>Os produtos antigos continuam armazenados, mas não aparecem na navegação, busca ou catálogo público.</p>
        <div>
          {Object.entries(archivedCategoryLabels).map(([key, label]) => (
            <span key={key}><strong>{label}</strong>{products.filter((product) => product.category === key).length} produtos inativos</span>
          ))}
        </div>
      </section>
    </>
  );
}
