"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useStore } from "./store-provider";
import { ProductVisual } from "./product-visual";
import { useCartProducts } from "./use-cart-products";

export function CartView() {
  const { items, updateQuantity, removeItem } = useStore();
  const { products, loading } = useCartProducts(items);
  const rows = items.map((item, index) => ({ item, index, product: products.find((product) => product.id === item.productId) })).filter((row) => row.product);
  const subtotal = rows.reduce((sum, row) => sum + (row.product?.promotionalPrice ?? row.product?.price ?? 0) * row.item.quantity, 0);

  if (items.length && loading) {
    return <div className="empty-cart"><p>Carregando os itens do carrinho...</p></div>;
  }

  if (!rows.length) {
    return (
      <div className="empty-cart">
        <ShoppingBag size={40} />
        <h2>Seu carrinho está vazio.</h2>
        <p>Explore a coleção demonstrativa e escolha seu próximo destaque.</p>
        <Link href="/catalogo" className="button button--dark">Ver catálogo <ArrowRight size={18} /></Link>
      </div>
    );
  }

  return (
    <div className="cart-layout">
      <div className="cart-items">
        {rows.map(({ item, index, product }) => product && (
          <article className="cart-item" key={`${item.productId}-${item.size}-${item.color}`}>
            <div className="cart-item__visual"><ProductVisual product={product} compact /></div>
            <div className="cart-item__info">
              <span className="eyebrow">{product.code}</span>
              <Link href={`/produto/${product.slug}`}><h2>{product.name}</h2></Link>
              <div className="cart-item__variants"><span>Tamanho: <strong>{item.size}</strong></span><span>Cor: <strong>{item.color}</strong></span></div>
              <div className="cart-item__controls">
                <div className="quantity-picker">
                  <button onClick={() => updateQuantity(index, item.quantity - 1)} aria-label="Diminuir quantidade"><Minus size={16} /></button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(index, item.quantity + 1)} aria-label="Aumentar quantidade"><Plus size={16} /></button>
                </div>
                <button className="remove-button" onClick={() => removeItem(index)}><Trash2 size={16} /> Remover</button>
              </div>
            </div>
            <strong className="cart-item__price">{formatCurrency((product.promotionalPrice ?? product.price) * item.quantity)}</strong>
          </article>
        ))}
      </div>
      <aside className="cart-summary">
        <span className="eyebrow eyebrow--red">RESUMO</span>
        <h2>Seu pedido</h2>
        <div className="summary-line"><span>Subtotal</span><strong>{formatCurrency(subtotal)}</strong></div>
        <div className="shipping-alert">
          <Truck />
          <p><strong>Escolha a entrega no checkout.</strong> Solicite análise de entrega local grátis em até 5 km ou o cálculo manual de um frete convencional.</p>
        </div>
        <div className="summary-total"><span>Total sem frete</span><strong>{formatCurrency(subtotal)}</strong></div>
        <Link href="/checkout" className="button button--red button--full">Ir para o checkout <ArrowRight size={18} /></Link>
        <Link href="/catalogo" className="continue-link">Continuar comprando</Link>
      </aside>
    </div>
  );
}
