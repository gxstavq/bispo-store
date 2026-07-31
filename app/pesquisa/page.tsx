import type { Metadata } from "next";
import { ProductGrid } from "@/components/product-grid";
import { PublicShell } from "@/components/public-shell";
import { productRepository } from "@/repositories/product-repository";

export const metadata: Metadata = { title: "Resultados da pesquisa", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const result = q ? await productRepository.search(q) : [];
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple">
        <div className="container">
          <span>PESQUISA</span>
          <h1>{q ? `Resultados para “${q}”` : "O que você procura?"}</h1>
          <p>{result.length} produtos encontrados.</p>
        </div>
      </section>
      <section className="section container">
        {result.length ? <ProductGrid products={result} /> : <div className="empty-state"><strong>Nada por aqui ainda.</strong><p>Tente buscar por “tênis”, “calça”, “conjunto” ou pelo código do produto.</p></div>}
      </section>
    </PublicShell>
  );
}
