import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/product-detail";
import { ProductGrid } from "@/components/product-grid";
import { PublicShell } from "@/components/public-shell";
import { publicCategoryLabels } from "@/lib/product-rules";
import { SectionTitle } from "@/components/section-title";
import { formatCurrency } from "@/lib/format";
import { safeJsonForHtml } from "@/lib/security/request";
import { productRepository } from "@/repositories/product-repository";

type ProductPageProps = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await productRepository.findBySlug(slug);
  if (!product) return { title: "Produto não encontrado" };
  return {
    title: product.name,
    description: product.description,
    openGraph: { title: `${product.name} | Bispo Store`, description: product.description },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await productRepository.findBySlug(slug);
  if (!product) notFound();
  const categoryProducts = await productRepository.findByCategory(product.category);
  const related = categoryProducts.filter((item) => item.id !== product.id).slice(0, 4);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.code,
    image: [`${process.env.NEXT_PUBLIC_SITE_URL ?? "https://bispastore.com.br"}/logo-bispo-store.png`],
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: product.promotionalPrice ?? product.price,
      availability: "https://schema.org/InStock",
      url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://bispastore.com.br"}/produto/${product.slug}`,
    },
  };

  return (
    <PublicShell>
      <section className="product-page container">
        <div className="breadcrumbs">Início / {publicCategoryLabels[product.category as keyof typeof publicCategoryLabels]} / <strong>{product.name}</strong></div>
        <ProductDetail product={product} />
      </section>
      <section className="section section--muted">
        <div className="container">
          <SectionTitle eyebrow="Continue explorando" title="Produtos relacionados" />
          <ProductGrid products={related} />
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonForHtml(structuredData) }} />
      <span className="sr-only">Preço demonstrativo: {formatCurrency(product.promotionalPrice ?? product.price)}</span>
    </PublicShell>
  );
}
