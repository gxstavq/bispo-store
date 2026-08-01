import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { PublicShell } from "@/components/public-shell";
import { fetchPublicCategories } from "@/repositories/category-repository";
import { fetchProductPage } from "@/repositories/supabase-product-repository";

export const metadata: Metadata = {
  title: "Conjuntos",
  description: "Conjuntos da curadoria urbana Bispo Store.",
};
export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const categories = await fetchPublicCategories();
  const { products, total } = await fetchProductPage({
    category: "conjuntos",
    offset: 0,
    limit: 24,
  });
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
        {products.length
          ? <CatalogView initialProducts={products} initialTotal={total} initialCategory="conjuntos" categories={categories} />
          : <div className="empty-state"><strong>Categoria preparada.</strong><p>Os produtos de conjuntos poderão ser cadastrados pelo painel.</p></div>}
      </section>
    </PublicShell>
  );
}
