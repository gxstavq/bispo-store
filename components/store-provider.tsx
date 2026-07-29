"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartItem } from "@/types/commerce";

interface StoreContextValue {
  items: CartItem[];
  cartCount: number;
  addItem: (item: CartItem) => void;
  updateQuantity: (index: number, quantity: number) => void;
  removeItem: (index: number) => void;
  clearCart: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);
const CART_KEY = "bispo-store-demo-cart";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CART_KEY);
      if (saved) {
        const savedItems = JSON.parse(saved) as CartItem[];
        const frame = window.requestAnimationFrame(() => {
          setItems(savedItems);
          setHydrated(true);
        });
        return () => window.cancelAnimationFrame(frame);
      }
    } catch {
      // A loja continua funcional mesmo com storage indisponível.
    }
    const frame = window.requestAnimationFrame(() => setHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // Sem ação: carrinho permanece ativo durante a sessão.
    }
  }, [hydrated, items]);

  const value = useMemo<StoreContextValue>(() => ({
    items,
    cartCount: items.reduce((sum, item) => sum + item.quantity, 0),
    addItem: (newItem) => setItems((current) => {
      const found = current.findIndex((item) =>
        item.productId === newItem.productId && item.size === newItem.size && item.color === newItem.color,
      );
      if (found === -1) return [...current, newItem];
      return current.map((item, index) =>
        index === found ? { ...item, quantity: item.quantity + newItem.quantity } : item,
      );
    }),
    updateQuantity: (index, quantity) =>
      setItems((current) => current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, quantity: Math.max(1, quantity) } : item,
      )),
    removeItem: (index) => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)),
    clearCart: () => setItems([]),
  }), [items]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore deve ser usado dentro de StoreProvider");
  return value;
}
