import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { PublicShell } from "@/components/public-shell";
import { fetchPublicCategories } from "@/repositories/category-repository";
import { fetchProductPage } from "@/repositories/supabase-product-repository";

export const metadata: Metadata = {
  title: "Calças",
  description: "Calças da curadoria urbana Bispo Store.",
};
export const dynamic = "force-dynamic";

export default async function PantsPage() {
  const categories = await fetchPublicCategories();
  const { products, total } = await fetchProductPage({
    category: "calcas",
    offset: 0,
    limit: 24,
  });
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
        {products.length
          ? <CatalogView initialProducts={products} initialTotal={total} initialCategory="calcas" categories={categories} />
          : <div className="empty-state"><strong>Categoria preparada.</strong><p>Os produtos de calças poderão ser cadastrados pelo painel.</p></div>}
      </section>
    </PublicShell>
  );
}
