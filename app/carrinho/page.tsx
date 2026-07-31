import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Carrinho", robots: { index: false } };

export default function CartPage() {
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple"><div className="container"><span>SELEÇÃO</span><h1>Seu carrinho.</h1><p>Revise tamanhos, cores e quantidades antes de continuar.</p></div></section>
      <section className="section container"><CartView /></section>
    </PublicShell>
  );
}
