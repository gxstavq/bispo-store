import Image from "next/image";
import type { Product } from "@/types/commerce";

export function ProductVisual({
  product,
  label,
  compact = false,
  priority = false,
}: {
  product: Product;
  label?: string;
  compact?: boolean;
  priority?: boolean;
}) {
  const fullPhoto = label && (label.startsWith("/") || /^https?:\/\//.test(label))
    ? label
    : product.coverImage ?? product.images.find((image) => image.startsWith("/") || /^https?:\/\//.test(image));
  const imageIndex = label
    ? product.images.indexOf(label)
    : product.images.indexOf(product.coverImage ?? product.images[0]);
  const photo = compact && imageIndex >= 0
    ? product.thumbnails?.[imageIndex] ?? fullPhoto
    : fullPhoto;

  if (product.imageType === "photo" && photo) {
    return (
      <div
        className={`product-visual product-visual--photo ${compact ? "product-visual--compact" : ""}`}
        role="img"
        aria-label={`Foto de ${product.name}`}
      >
        <Image
          src={photo}
          alt={product.name}
          fill
          sizes={compact ? "(max-width: 560px) 50vw, (max-width: 1060px) 33vw, 25vw" : "(max-width: 820px) 100vw, 55vw"}
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          quality={85}
          unoptimized
        />
        {product.needsReview && <span className="review-stamp">CADASTRO PENDENTE</span>}
      </div>
    );
  }

  return (
    <div
      className={`product-visual product-visual--${product.visual.type} ${compact ? "product-visual--compact" : ""}`}
      style={{ "--accent": product.visual.accent, "--secondary": product.visual.secondary } as React.CSSProperties}
      role="img"
      aria-label={`Imagem demonstrativa de ${product.name}${label ? ` — ${label}` : ""}`}
    >
      <span className="demo-stamp">IMAGEM DEMO</span>
      <span className="visual-orbit" />
      {product.visual.type === "shoe" && (
        <span className="shoe-shape"><i /><b /></span>
      )}
      {product.visual.type === "shirt" && (
        <span className="shirt-shape"><i>BS</i></span>
      )}
      {product.visual.type === "hoodie" && (
        <span className="hoodie-shape"><i>BS</i></span>
      )}
      {product.visual.type === "bottom" && (
        <span className="bottom-shape"><i /></span>
      )}
      <span className="visual-code">{label ?? product.code}</span>
    </div>
  );
}
