"use client";

import Image from "next/image";
import Link from "next/link";
import { Copy, EyeOff, Pencil, Search, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { allCategoryLabels as adminCategoryLabels } from "@/lib/product-rules";
import type { Product, ProductCategory, ProductStatus } from "@/types/commerce";

export function AdminProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [status, setStatus] = useState<ProductStatus | "all">("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const pageSize = 25;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const query = new URLSearchParams({
      includeInactive: "true",
      paginated: "true",
      page: String(page),
      pageSize: String(pageSize),
    });
    if (search.trim()) query.set("search", search.trim());
    if (category !== "all") query.set("category", category);
    if (status !== "all") query.set("status", status);
    const response = await fetch(`/api/products?${query}`, {
      cache: "no-store",
      signal,
    });
    const result = await response.json() as {
      products?: Product[];
      total?: number;
      error?: string;
    };
    if (!response.ok || !result.products || result.total === undefined) {
      if (!signal?.aborted) setMessage(result.error ?? "Não foi possível carregar os produtos.");
    } else {
      setProducts(result.products);
      setTotal(result.total);
    }
    if (!signal?.aborted) setLoading(false);
  }, [category, page, search, status]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, search]);

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
        <div className="admin-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar produto ou código..." /></div>
        <select value={category} onChange={(event) => { setCategory(event.target.value as ProductCategory | "all"); setPage(1); }}>
          <option value="all">Todas as categorias</option>
          {Object.entries(adminCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => { setStatus(event.target.value as ProductStatus | "all"); setPage(1); }}>
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="draft">Rascunhos</option>
          <option value="archived">Arquivados</option>
        </select>
      </div>
      <div className="admin-list-summary">
        <span>{loading ? "Carregando..." : `${products.length} de ${total} produtos`}</span>
        <span>Dados persistidos no <strong>Supabase Postgres</strong></span>
      </div>
      {message && <div className="admin-feedback" role="status">{message}</div>}
      <section className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table admin-products-table">
            <thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Revisão</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {products.map((product) => {
                const cover = product.coverImage ?? product.images[0];
                const coverIndex = product.images.indexOf(cover);
                const thumb = product.thumbnails?.[coverIndex] ?? cover;
                const productStatus = product.status ?? (product.active ? "active" : "inactive");
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="admin-product-cell">
                        <span className="admin-product-thumb">
                          {thumb && (thumb.startsWith("/") || /^https?:\/\//.test(thumb)) ? <Image src={thumb} alt="" fill sizes="42px" quality={70} /> : null}
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
      {total > pageSize && (
        <div className="admin-pagination">
          <button type="button" className="button button--dark" disabled={loading || page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button>
          <span>Página {page} de {Math.ceil(total / pageSize)}</span>
          <button type="button" className="button button--dark" disabled={loading || page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Próxima</button>
        </div>
      )}
    </>
  );
}
