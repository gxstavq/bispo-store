"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { publicCategoryLabels } from "@/lib/product-rules";
import type { Product, SellableProductCategory } from "@/types/commerce";
import { ProductGrid } from "./product-grid";

export function CatalogView({ products, initialFilter }: { products: Product[]; initialFilter?: string }) {
  const [category, setCategory] = useState<SellableProductCategory | "todos">("todos");
  const [sort, setSort] = useState("destaques");

  const visible = useMemo(() => {
    let filtered = [...products];
    if (category !== "todos") filtered = filtered.filter((product) => product.category === category);
    if (initialFilter === "ofertas") filtered = filtered.filter((product) => product.promotionalPrice);
    if (initialFilter === "lancamentos") filtered = filtered.filter((product) => product.isNew);
    if (sort === "menor") filtered.sort((a, b) => (a.promotionalPrice ?? a.price) - (b.promotionalPrice ?? b.price));
    if (sort === "maior") filtered.sort((a, b) => (b.promotionalPrice ?? b.price) - (a.promotionalPrice ?? a.price));
    if (sort === "novos") filtered.sort((a, b) => Number(b.isNew) - Number(a.isNew));
    return filtered;
  }, [category, initialFilter, products, sort]);

  return (
    <>
      <div className="catalog-toolbar">
        <div className="filter-group">
          <SlidersHorizontal size={18} />
          <button className={category === "todos" ? "is-active" : ""} onClick={() => setCategory("todos")}>Todos</button>
          {(Object.entries(publicCategoryLabels) as Array<[SellableProductCategory, string]>).map(([key, label]) => (
            <button key={key} className={category === key ? "is-active" : ""} onClick={() => setCategory(key)}>{label}</button>
          ))}
        </div>
        <label>Ordenar
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="destaques">Destaques</option>
            <option value="novos">Lançamentos</option>
            <option value="menor">Menor preço</option>
            <option value="maior">Maior preço</option>
          </select>
        </label>
      </div>
      <p className="result-count">{visible.length} produtos demonstrativos encontrados</p>
      <ProductGrid products={visible} />
    </>
  );
}
