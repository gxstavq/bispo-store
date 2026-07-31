"use client";

import { useEffect, useMemo, useState } from "react";
import type { CartItem, Product } from "@/types/commerce";

const productCache = new Map<string, Product[]>();

export function useCartProducts(items: CartItem[]) {
  const key = useMemo(
    () => [...new Set(items.map((item) => item.productId))].sort().join(","),
    [items],
  );
  const [resolved, setResolved] = useState<{ key: string; products: Product[] }>(
    () => ({ key, products: productCache.get(key) ?? [] }),
  );

  useEffect(() => {
    if (!key || productCache.has(key)) return;

    const controller = new AbortController();
    void fetch(`/api/products?ids=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar os itens do carrinho.");
        return response.json() as Promise<Product[]>;
      })
      .then((result) => {
        productCache.set(key, result);
        setResolved({ key, products: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved({ key, products: [] });
      });

    return () => controller.abort();
  }, [key]);

  const products = key
    ? productCache.get(key) ?? (resolved.key === key ? resolved.products : [])
    : [];
  const loading = Boolean(key)
    && !productCache.has(key)
    && resolved.key !== key;
  return { products, loading };
}
