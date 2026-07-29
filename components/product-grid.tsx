import type { Product } from "@/types/commerce";
import { ProductCard } from "./product-card";

export function ProductGrid({ products, className = "" }: { products: Product[]; className?: string }) {
  return (
    <div className={`product-grid ${className}`}>
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
