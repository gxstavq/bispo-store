import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = { title: "Checkout demonstrativo", robots: { index: false } };

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const products = await productRepository.list();
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple"><div className="container"><span>FINALIZAÇÃO SEGURA</span><h1>Checkout.</h1><p>Preencha apenas com dados fictícios para visualizar o fluxo.</p></div></section>
      <section className="section container"><CheckoutForm products={products} /></section>
    </PublicShell>
  );
}
