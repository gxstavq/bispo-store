"use client";

import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Product, ProductCategoryRecord, SellableProductCategory } from "@/types/commerce";
import { ProductGrid } from "./product-grid";

const PAGE_SIZE = 24;

type CatalogSort = "destaques" | "novos" | "menor" | "maior";

type CatalogPageResponse = {
  products?: Product[];
  total?: number;
  error?: string;
};

export function CatalogView({
  initialProducts,
  initialTotal,
  initialFilter,
  initialCategory = "todos",
  categories = [],
}: {
  initialProducts: Product[];
  initialTotal: number;
  initialFilter?: string;
  initialCategory?: SellableProductCategory | "todos";
  categories?: ProductCategoryRecord[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [total, setTotal] = useState(initialTotal);
  const [category, setCategory] = useState<SellableProductCategory | "todos">(initialCategory);
  const [sort, setSort] = useState<CatalogSort>("destaques");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initialRender = useRef(true);

  const load = useCallback(async (targetPage: number, append: boolean, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      paginated: "true",
      page: String(targetPage),
      pageSize: String(PAGE_SIZE),
      sort,
    });
    if (category !== "todos") query.set("category", category);
    if (initialFilter) query.set("filter", initialFilter);
    try {
      const response = await fetch(`/api/products?${query}`, {
        signal,
        cache: "no-store",
      });
      const result = await response.json() as CatalogPageResponse;
      if (!response.ok || !result.products || result.total === undefined) {
        throw new Error(result.error ?? "Não foi possível carregar os produtos.");
      }
      setProducts((current) => append
        ? [...current, ...result.products!.filter(
          (product) => !current.some((item) => item.id === product.id),
        )]
        : result.products!);
      setTotal(result.total);
      setPage(targetPage);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os produtos.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [category, initialFilter, sort]);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    const controller = new AbortController();
    void load(1, false, controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <div className="catalog-toolbar">
        <div className="filter-group">
          <SlidersHorizontal size={18} />
          <button type="button" className={category === "todos" ? "is-active" : ""} onClick={() => setCategory("todos")}>Todos</button>
          {categories.map((item) => (
            <button type="button" key={item.id} className={category === item.slug ? "is-active" : ""} onClick={() => setCategory(item.slug)}>{item.name}</button>
          ))}
        </div>
        <label>Ordenar
          <select value={sort} onChange={(event) => setSort(event.target.value as CatalogSort)}>
            <option value="destaques">Destaques</option>
            <option value="novos">Lançamentos</option>
            <option value="menor">Menor preço</option>
            <option value="maior">Maior preço</option>
          </select>
        </label>
      </div>
      <p className="result-count">{total} produtos encontrados</p>
      <ProductGrid products={products} />
      {error && <div className="admin-feedback" role="alert">{error}</div>}
      {products.length < total && (
        <div className="catalog-load-more">
          <button
            type="button"
            className="button button--dark"
            disabled={loading}
            onClick={() => void load(page + 1, true)}
          >
            {loading ? "Carregando..." : `Carregar mais produtos (${products.length} de ${total})`}
          </button>
        </div>
      )}
    </>
  );
}
