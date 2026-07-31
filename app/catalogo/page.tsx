import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { PublicShell } from "@/components/public-shell";
import { fetchProductPage } from "@/repositories/supabase-product-repository";

export const metadata: Metadata = {
  title: "Catálogo completo",
  description: "Explore tênis, calças e conjuntos da coleção demonstrativa Bispo Store.",
};
export const revalidate = 60;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const { filtro } = await searchParams;
  const { products, total } = await fetchProductPage({
    offset: 0,
    limit: 24,
    isNew: filtro === "lancamentos" ? true : undefined,
    onSale: filtro === "ofertas",
  });
  return (
    <PublicShell>
      <section className="page-hero page-hero--catalog">
        <div className="container">
          <span>DROP DEMO 001</span>
          <h1>{filtro === "ofertas" ? "Ofertas" : filtro === "lancamentos" ? "Lançamentos" : "Catálogo completo"}</h1>
          <p>Uma vitrine conceitual pronta para receber os produtos reais da Bispo Store.</p>
        </div>
      </section>
      <section className="section container">
        <CatalogView
          initialProducts={products}
          initialTotal={total}
          initialFilter={filtro}
        />
      </section>
    </PublicShell>
  );
}
