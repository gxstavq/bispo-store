import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = { title: "Carrinho", robots: { index: false } };

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const products = await productRepository.list();
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple"><div className="container"><span>SELEÇÃO</span><h1>Seu carrinho.</h1><p>Revise tamanhos, cores e quantidades antes de continuar.</p></div></section>
      <section className="section container"><CartView products={products} /></section>
    </PublicShell>
  );
}
