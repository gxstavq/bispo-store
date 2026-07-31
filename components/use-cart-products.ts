"use client";

import { useEffect, useMemo, useState } from "react";
import type { CartItem, Product } from "@/types/commerce";

const productCache = new Map<string, Product[]>();

export function useCartProducts(items: CartItem[]) {
  const key = useMemo(
    () => [...new Set(items.map((item) => item.productId))].sort().join(","),
    [items],
  );
  const [resolved, setResolved] = useState<{
    key: string;
    products: Product[];
    loading: boolean;
  }>(
    () => ({
      key,
      products: productCache.get(key) ?? [],
      loading: Boolean(key) && !productCache.has(key),
    }),
  );

  useEffect(() => {
    if (!key || productCache.has(key)) return;

    const controller = new AbortController();
    void fetch(`/api/products?ids=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar os itens do carrinho.");
        const result: unknown = await response.json();
        if (!Array.isArray(result)) {
          throw new Error("Formato inesperado ao carregar os itens do carrinho.");
        }
        return result as Product[];
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        productCache.set(key, result);
        setResolved({ key, products: result, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolved({ key, products: [], loading: false });
        }
      });

    return () => controller.abort();
  }, [key]);

  const products = key
    ? productCache.get(key) ?? (resolved.key === key ? resolved.products : [])
    : [];
  const loading = Boolean(key)
    && !productCache.has(key)
    && (resolved.key !== key || resolved.loading);
  return { products, loading };
}
