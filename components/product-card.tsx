import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Product } from "@/types/commerce";
import { formatCurrency } from "@/lib/format";
import { ProductVisual } from "./product-visual";

export function ProductCard({
  product,
  showInternalLabels = true,
}: {
  product: Product;
  showInternalLabels?: boolean;
}) {
  const price = product.promotionalPrice ?? product.price;
  const discount = product.promotionalPrice
    ? Math.round((1 - product.promotionalPrice / product.price) * 100)
    : 0;

  return (
    <article className="product-card">
      <Link href={`/produto/${product.slug}`} className="product-card__image" aria-label={`Ver ${product.name}`}>
        <ProductVisual product={product} compact showStatus={showInternalLabels} />
        <div className="product-card__badges">
          {product.isNew && <span className="badge badge--dark">Novo</span>}
          {discount > 0 && <span className="badge badge--red">-{discount}%</span>}
        </div>
        <span className="product-card__arrow"><ArrowUpRight size={18} /></span>
      </Link>
      <div className="product-card__body">
        <span className="eyebrow">
          {product.code}
          {showInternalLabels && <> · {product.needsReview ? "PENDENTE DE REVISÃO" : "DADO DEMO"}</>}
        </span>
        <Link href={`/produto/${product.slug}`}><h3>{product.name}</h3></Link>
        <div className="price-row">
          <strong>{formatCurrency(price)}</strong>
          {product.promotionalPrice && <s>{formatCurrency(product.price)}</s>}
        </div>
        <span className="installment">ou 6x de {formatCurrency(price / 6)} sem juros*</span>
      </div>
    </article>
  );
}
