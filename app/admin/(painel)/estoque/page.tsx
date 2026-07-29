import { AlertTriangle, Download, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export default async function StockPage() {
  const products = await fetchProducts({ includeInactive: true });
  const total = products.reduce((sum, product) => sum + product.stock, 0);
  return (
    <>
      <AdminPageHeader eyebrow="INVENTÁRIO" title="Estoque." description={`${total} unidades cadastradas em ${products.length} produtos no Supabase.`} action={<button className="button button--dark"><Download size={18} /> Exportar relatório</button>} />
      <div className="admin-toolbar"><div className="admin-search"><Search size={17} /><input placeholder="Buscar por produto ou SKU..." /></div><label className="admin-toggle"><input type="checkbox" /> Apenas baixo estoque</label></div>
      <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Produto</th><th>SKU</th><th>Tamanhos</th><th>Estoque</th><th>Nível</th><th>Ação</th></tr></thead><tbody>
        {products.map((product) => { const low = product.stock <= 5; return <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.code}</td><td>{product.sizes.join(", ")}</td><td><strong className={low ? "stock-low" : ""}>{product.stock} un.</strong></td><td><div className="stock-bar"><span style={{ width: `${Math.min(100, product.stock * 4)}%` }} className={low ? "is-low" : ""} /></div></td><td>{low ? <span className="stock-warning"><AlertTriangle size={15} /> Repor</span> : <button className="table-button">Ajustar</button>}</td></tr>; })}
      </tbody></table></div></section>
    </>
  );
}
