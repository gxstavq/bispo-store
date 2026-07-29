"use client";

import Image from "next/image";
import Link from "next/link";
import { Copy, EyeOff, Pencil, Search, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { allCategoryLabels as adminCategoryLabels } from "@/lib/product-rules";
import type { Product, ProductCategory, ProductStatus } from "@/types/commerce";

export function AdminProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [status, setStatus] = useState<ProductStatus | "all">("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/products?includeInactive=true", { cache: "no-store" });
    setProducts(await response.json() as Product[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/products?includeInactive=true", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: Product[]) => {
        if (!active) return;
        setProducts(data);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => products.filter((product) => {
    const haystack = `${product.name} ${product.code}`.toLocaleLowerCase("pt-BR");
    return haystack.includes(search.toLocaleLowerCase("pt-BR"))
      && (category === "all" || product.category === category)
      && (status === "all" || (product.status ?? (product.active ? "active" : "inactive")) === status);
  }), [category, products, search, status]);

  async function action(product: Product, operation: "duplicate" | "publish" | "deactivate" | "delete") {
    if (operation === "delete" && !window.confirm(`Excluir ${product.name}? O arquivo da foto não será apagado.`)) return;
    const response = operation === "delete"
      ? await fetch(`/api/products/${product.id}`, { method: "DELETE" })
      : await fetch(`/api/products/${product.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: operation }),
      });
    if (!response.ok) {
      setMessage("Não foi possível concluir a ação.");
      return;
    }
    setMessage({
      duplicate: "Produto duplicado como rascunho.",
      publish: "Produto publicado e marcado como revisado.",
      deactivate: "Produto desativado.",
      delete: "Produto arquivado no Supabase.",
    }[operation]);
    await load();
  }

  return (
    <>
      <div className="admin-toolbar admin-products-toolbar">
        <div className="admin-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou código..." /></div>
        <select value={category} onChange={(event) => setCategory(event.target.value as ProductCategory | "all")}>
          <option value="all">Todas as categorias</option>
          {Object.entries(adminCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as ProductStatus | "all")}>
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="draft">Rascunhos</option>
          <option value="archived">Arquivados</option>
        </select>
      </div>
      <div className="admin-list-summary">
        <span>{loading ? "Carregando..." : `${visible.length} de ${products.length} produtos`}</span>
        <span>Dados persistidos no <strong>Supabase Postgres</strong></span>
      </div>
      {message && <div className="admin-feedback" role="status">{message}</div>}
      <section className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table admin-products-table">
            <thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Revisão</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {visible.map((product) => {
                const cover = product.coverImage ?? product.images[0];
                const coverIndex = product.images.indexOf(cover);
                const thumb = product.thumbnails?.[coverIndex] ?? cover;
                const productStatus = product.status ?? (product.active ? "active" : "inactive");
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="admin-product-cell">
                        <span className="admin-product-thumb">
                          {thumb && (thumb.startsWith("/") || /^https?:\/\//.test(thumb)) ? <Image src={thumb} alt="" fill sizes="42px" unoptimized /> : null}
                        </span>
                        <div><strong>{product.name}</strong><small>{product.code} · {product.images.length} imagens</small></div>
                      </div>
                    </td>
                    <td>{adminCategoryLabels[product.category]}</td>
                    <td>{formatCurrency(product.promotionalPrice ?? product.price)}</td>
                    <td><strong className={product.stock <= 5 ? "stock-low" : ""}>{product.stock}</strong></td>
                    <td>{product.needsReview ? <span className="review-badge">Pendente</span> : <span className="review-badge is-reviewed">Revisado</span>}</td>
                    <td><span className={`status-badge status-${productStatus}`}>{productStatus === "active" ? "ativo" : productStatus === "inactive" ? "inativo" : productStatus === "archived" ? "arquivado" : "rascunho"}</span></td>
                    <td>
                      <div className="product-actions">
                        <Link href={`/admin/produtos/${product.id}`} title="Editar"><Pencil size={16} /><span>Editar</span></Link>
                        <button onClick={() => void action(product, "duplicate")} title="Duplicar"><Copy size={16} /><span>Duplicar</span></button>
                        {productStatus !== "active" && <button onClick={() => void action(product, "publish")} title="Publicar"><Send size={16} /><span>Publicar</span></button>}
                        {productStatus === "active" && <button onClick={() => void action(product, "deactivate")} title="Desativar"><EyeOff size={16} /><span>Desativar</span></button>}
                        <button className="is-danger" onClick={() => void action(product, "delete")} title="Excluir"><Trash2 size={16} /><span>Excluir</span></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
