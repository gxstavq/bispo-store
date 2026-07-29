"use client";

import { Check, MessageCircle, Minus, Plus, ShoppingBag, Truck } from "lucide-react";
import { useState } from "react";
import type { Product } from "@/types/commerce";
import { formatCurrency, whatsappUrl } from "@/lib/format";
import { useStore } from "./store-provider";
import { ProductVisual } from "./product-visual";

export function ProductDetail({ product }: { product: Product }) {
  const { addItem } = useStore();
  const [size, setSize] = useState("");
  const [color, setColor] = useState(product.colors[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const price = product.promotionalPrice ?? product.price;

  const addToCart = () => {
    if (!size) {
      setError("Escolha um tamanho antes de adicionar.");
      return;
    }
    addItem({ productId: product.id, size, color, quantity });
    setError("");
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2500);
  };

  return (
    <div className="product-detail">
      <div className="product-gallery">
        <div className="product-thumbs">
          {product.images.map((image, index) => (
            <button key={image} className={selectedImage === index ? "is-active" : ""} onClick={() => setSelectedImage(index)} aria-label={`Ver foto ${index + 1} de ${product.name}`}>
              <ProductVisual product={product} label={image} compact />
            </button>
          ))}
        </div>
        <div className="product-gallery__main">
          <ProductVisual product={product} label={product.images[selectedImage]} priority />
        </div>
      </div>

      <div className="product-info">
        <div className="product-info__top">
          <span className="demo-pill">PRODUTO DEMONSTRATIVO</span>
          <span className="stock-status"><i /> {product.stock} unidades disponíveis</span>
        </div>
        <span className="eyebrow">{product.code}</span>
        <h1>{product.name}</h1>
        <p className="product-intro">{product.description}</p>
        <div className="product-price">
          <strong>{formatCurrency(price)}</strong>
          {product.promotionalPrice && <s>{formatCurrency(product.price)}</s>}
          <span>em até 6x de {formatCurrency(price / 6)} sem juros*</span>
        </div>

        <fieldset className="option-group">
          <legend>Tamanho <em>obrigatório</em></legend>
          <div className="size-options">
            {product.sizes.map((item) => <button type="button" key={item} className={size === item ? "is-active" : ""} onClick={() => setSize(item)}>{item}</button>)}
          </div>
        </fieldset>
        <fieldset className="option-group">
          <legend>Cor <strong>{color}</strong></legend>
          <div className="color-options">
            {product.colors.map((item) => <button type="button" key={item} className={color === item ? "is-active" : ""} onClick={() => setColor(item)}><i />{item}</button>)}
          </div>
        </fieldset>

        <div className="buy-row">
          <div className="quantity-picker">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Diminuir quantidade"><Minus size={17} /></button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity(quantity + 1)} aria-label="Aumentar quantidade"><Plus size={17} /></button>
          </div>
          <button className="button button--red button--grow" onClick={addToCart}>
            {added ? <><Check size={19} /> Adicionado</> : <><ShoppingBag size={19} /> Adicionar ao carrinho</>}
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}

        <div className="shipping-note">
          <Truck />
          <div><strong>Entrega em todo o Brasil</strong><p>Calcule o frete pelo CEP. Em SP, também é possível solicitar análise de entrega local grátis em até 5 km.</p></div>
        </div>
        <a className="whatsapp-product" href={whatsappUrl(`Olá! Tenho uma dúvida sobre o produto ${product.name}.`)} target="_blank" rel="noreferrer">
          <MessageCircle size={19} /> Tirar dúvida sobre este produto
        </a>
      </div>
    </div>
  );
}
