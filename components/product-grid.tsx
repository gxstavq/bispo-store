import type { Product } from "@/types/commerce";
import { ProductCard } from "./product-card";

export function ProductGrid({
  products,
  className = "",
  showInternalLabels = true,
}: {
  products: Product[];
  className?: string;
  showInternalLabels?: boolean;
}) {
  return (
    <div className={`product-grid ${className}`}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} showInternalLabels={showInternalLabels} />
      ))}
    </div>
  );
}
