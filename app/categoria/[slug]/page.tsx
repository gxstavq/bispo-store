import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog-view";
import { PublicShell } from "@/components/public-shell";
import { fetchPublicCategories } from "@/repositories/category-repository";
import { fetchProductPage } from "@/repositories/supabase-product-repository";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = (await fetchPublicCategories()).find((item) => item.slug === slug);
  if (!category) return { title: "Categoria não encontrada" };
  return { title: category.name, description: category.description ?? `Produtos de ${category.name} da Bispo Store.` };
}

export default async function DynamicCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categories = await fetchPublicCategories();
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();
  const { products, total } = await fetchProductPage({ category: slug, offset: 0, limit: 24 });
  return <PublicShell>
    <section className="category-hero category-hero--clothes"><div className="container"><span className="category-hero__index">CATEGORIA</span><h1>{category.name}</h1><p>{category.description ?? `Explore a seleção de ${category.name} da Bispo Store.`}</p></div></section>
    <section className="section container">{products.length
      ? <CatalogView initialProducts={products} initialTotal={total} initialCategory={slug} categories={categories} />
      : <div className="empty-state"><strong>Categoria preparada.</strong><p>Novos produtos serão adicionados pelo painel.</p></div>}
    </section>
  </PublicShell>;
}
