import type { Metadata } from "next";
import { ProductGrid } from "@/components/product-grid";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = {
  title: "Calças",
  description: "Calças da curadoria urbana Bispo Store.",
};
export const dynamic = "force-dynamic";

export default async function PantsPage() {
  const products = await productRepository.findByCategory("calcas");
  return (
    <PublicShell>
      <section className="category-hero category-hero--clothes">
        <div className="container">
          <span className="category-hero__index">02 / CALÇAS</span>
          <h1>Base forte.<br />Movimento livre.</h1>
          <p>Modelagens urbanas preparadas para acompanhar a rua, o trabalho e o fim de semana.</p>
        </div>
      </section>
      <section className="section container">
        <div className="category-results"><strong>{products.length} peças</strong><span>Produtos demonstrativos</span></div>
        {products.length ? <ProductGrid products={products} /> : <div className="empty-state"><strong>Categoria preparada.</strong><p>Os produtos de calças poderão ser cadastrados pelo painel.</p></div>}
      </section>
    </PublicShell>
  );
}
