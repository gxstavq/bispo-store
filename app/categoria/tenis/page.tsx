import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { PublicShell } from "@/components/public-shell";
import { fetchProductPage } from "@/repositories/supabase-product-repository";

export const metadata: Metadata = {
  title: "Tênis",
  description: "Sneakers de demonstração com estética urbana e curadoria Bispo Store.",
};
export const revalidate = 60;

export default async function SneakersPage() {
  const { products, total } = await fetchProductPage({
    category: "tenis",
    offset: 0,
    limit: 24,
  });
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
        <CatalogView initialProducts={products} initialTotal={total} initialCategory="tenis" />
      </section>
    </PublicShell>
  );
}
