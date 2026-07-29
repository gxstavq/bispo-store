import type { Metadata } from "next";
import { ProductGrid } from "@/components/product-grid";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = {
  title: "Tênis",
  description: "Sneakers de demonstração com estética urbana e curadoria Bispo Store.",
};
export const dynamic = "force-dynamic";

export default async function SneakersPage() {
  const sneakers = await productRepository.findByCategory("tenis");
  return (
    <PublicShell>
      <section className="category-hero category-hero--sneakers">
        <div className="container">
          <span className="category-hero__index">01 / SNEAKERS</span>
          <h1>O passo<br />fala primeiro.</h1>
          <p>Silhuetas urbanas, volumes marcantes e o contraste que define a Bispo.</p>
        </div>
      </section>
      <section className="section container">
        <div className="category-results"><strong>{sneakers.length} modelos</strong><span>Produtos e imagens demonstrativos</span></div>
        <ProductGrid products={sneakers} />
      </section>
    </PublicShell>
  );
}
