"use client";

import Image from "next/image";
import Link from "next/link";
import { Archive, Copy, EyeOff, Pencil, Search, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { categoryLabel } from "@/lib/product-rules";
import type { Product, ProductCategory, ProductCategoryRecord, ProductStatus } from "@/types/commerce";

export function AdminProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [status, setStatus] = useState<ProductStatus | "all">("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [categoryOptions, setCategoryOptions] = useState<ProductCategoryRecord[]>([]);

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

  useEffect(() => {
    fetch("/api/admin/categories", { cache: "no-store" }).then((response) => response.json())
      .then((result: { categories?: ProductCategoryRecord[] }) => setCategoryOptions(result.categories ?? []))
      .catch(() => setCategoryOptions([]));
  }, []);

  async function action(product: Product, operation: "duplicate" | "publish" | "deactivate" | "archive") {
    const response = operation === "archive"
      ? await fetch(`/api/products/${product.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "archive" }),
      })
      : await fetch(`/api/products/${product.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: operation }),
      });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      setMessageTone("error");
      setMessage(result.error ?? "Não foi possível concluir a ação.");
      return;
    }
    setMessageTone("success");
    setMessage({
      duplicate: "Produto duplicado como rascunho.",
      publish: "Produto publicado e marcado como revisado.",
      deactivate: "Produto desativado.",
      archive: "Produto arquivado e removido do catálogo público.",
    }[operation]);
    await load();
  }

  async function deletePermanently() {
    if (!deleteTarget) return;
    setLoading(true);
    const response = await fetch(`/api/products/${deleteTarget.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "delete", confirmation: deleteConfirmation }),
    });
    const result = await response.json() as {
      error?: string;
      result?: { deleted?: boolean; archived?: boolean; had_dependencies?: boolean };
    };
    setLoading(false);
    if (!response.ok) {
      setMessageTone("error"); setMessage(result.error ?? "Não foi possível excluir o produto."); return;
    }
    setDeleteTarget(null);
    setDeleteConfirmation("");
    setMessageTone("success");
    setMessage(result.result?.deleted
      ? "Produto excluído definitivamente. Arquivos compartilhados foram preservados."
      : "O produto possui dependências históricas e foi arquivado para preservar pedidos, reservas ou movimentações de estoque.");
    await load();
  }

  return (
    <>
      <div className="admin-toolbar admin-products-toolbar">
        <div className="admin-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar produto ou código..." /></div>
        <select value={category} onChange={(event) => { setCategory(event.target.value as ProductCategory | "all"); setPage(1); }}>
          <option value="all">Todas as categorias</option>
          {categoryOptions.map((item) => <option value={item.slug} key={item.id}>{item.name}</option>)}
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
      {message && <div className={`admin-feedback is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</div>}
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
                    <td>{categoryLabel(product.category)}</td>
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
                        {productStatus !== "archived" && <button onClick={() => void action(product, "archive")} title="Arquivar"><Archive size={16} /><span>Arquivar</span></button>}
                        <button className="is-danger" onClick={() => setDeleteTarget(product)} title="Excluir definitivamente"><Trash2 size={16} /><span>Excluir</span></button>
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
      {deleteTarget && <div className="admin-modal-backdrop" role="presentation">
        <section className="admin-modal" role="dialog" aria-modal="true" aria-label="Excluir produto definitivamente">
          <div className="admin-panel__header"><div><span>EXCLUSÃO DEFINITIVA</span><h2>{deleteTarget.name}</h2></div><button type="button" onClick={() => setDeleteTarget(null)} aria-label="Fechar"><X /></button></div>
          <p>Código: <strong>{deleteTarget.code}</strong></p>
          <p>Se houver pedido, reserva ou dependência histórica, o produto será apenas arquivado.</p>
          <label>Digite <strong>EXCLUIR</strong> para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label>
          <div className="decision-actions"><button type="button" className="button button--dark" onClick={() => setDeleteTarget(null)}>Cancelar</button><button type="button" className="button button--outline-danger" disabled={deleteConfirmation !== "EXCLUIR" || loading} onClick={() => void deletePermanently()}>Excluir definitivamente</button></div>
        </section>
      </div>}
    </>
  );
}
