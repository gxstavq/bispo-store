import type { Metadata } from "next";
import { ProductGrid } from "@/components/product-grid";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = {
  title: "Conjuntos",
  description: "Conjuntos da curadoria urbana Bispo Store.",
};
export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const products = await productRepository.findByCategory("conjuntos");
  return (
    <PublicShell>
      <section className="category-hero category-hero--sets">
        <div className="container">
          <span className="category-hero__index">03 / CONJUNTOS</span>
          <h1>Visual completo.<br />Sem esforço.</h1>
          <p>Combinações coordenadas para criar presença com praticidade e identidade.</p>
        </div>
      </section>
      <section className="section container">
        <div className="category-results"><strong>{products.length} conjuntos</strong><span>Produtos demonstrativos</span></div>
        {products.length ? <ProductGrid products={products} /> : <div className="empty-state"><strong>Categoria preparada.</strong><p>Os produtos de conjuntos poderão ser cadastrados pelo painel.</p></div>}
      </section>
    </PublicShell>
  );
}
