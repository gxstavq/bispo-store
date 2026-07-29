"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, ImagePlus, Save, Star, Trash2 } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultsForCategory } from "@/lib/product-rules";
import type { PackagingCategory, Product, ProductStatus, SellableProductCategory } from "@/types/commerce";

const blankProduct: Product = {
  id: "",
  name: "",
  slug: "",
  code: "",
  category: "tenis",
  description: "Produto provisório aguardando cadastro",
  price: 0,
  images: [],
  thumbnails: [],
  sizes: ["38", "39", "40", "41", "42"],
  colors: ["A definir"],
  stock: 0,
  weightKg: undefined,
  lengthCm: undefined,
  widthCm: undefined,
  heightCm: undefined,
  packagingCategory: undefined,
  shippingEnabled: true,
  featured: false,
  isNew: false,
  active: false,
  status: "draft",
  needsReview: true,
  demo: true,
  imageType: "photo",
  visual: { accent: "#ef2b35", secondary: "#f7f7f4", type: "shoe" },
};

export function ProductFormDemo({ productId }: { productId?: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product>(blankProduct);
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!productId) return;
    fetch(`/api/products/${productId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: Product) => setProduct(data))
      .finally(() => setLoading(false));
  }, [productId]);

  const update = <K extends keyof Product>(key: K, value: Product[K]) =>
    setProduct((current) => ({ ...current, [key]: value }));

  function changeCategory(category: SellableProductCategory) {
    const defaults = defaultsForCategory(category);
    setProduct((current) => ({
      ...current,
      category,
      weightKg: current.weightKg ?? defaults?.weightKg,
      lengthCm: current.lengthCm ?? defaults?.lengthCm,
      widthCm: current.widthCm ?? defaults?.widthCm,
      heightCm: current.heightCm ?? defaults?.heightCm,
      packagingCategory: current.packagingCategory ?? defaults?.packagingCategory,
    }));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= product.images.length) return;
    setProduct((current) => {
      const images = [...current.images];
      [images[index], images[destination]] = [images[destination], images[index]];
      const thumbnails = current.thumbnails ? [...current.thumbnails] : undefined;
      if (thumbnails && thumbnails.length === images.length) {
        [thumbnails[index], thumbnails[destination]] = [thumbnails[destination], thumbnails[index]];
      }
      return { ...current, images, thumbnails };
    });
  }

  function removeImage(image: string) {
    setProduct((current) => ({
      ...current,
      images: current.images.filter((candidate) => candidate !== image),
      thumbnails: current.thumbnails?.filter((_, index) => current.images[index] !== image),
      coverImage: current.coverImage === image
        ? current.images.filter((candidate) => candidate !== image)[0]
        : current.coverImage,
    }));
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
    const result = await response.json() as { path?: string; error?: string };
    if (!response.ok || !result.path) {
      setMessage(result.error ?? "Falha no envio da imagem.");
      return;
    }
    setProduct((current) => ({
      ...current,
      images: [...current.images, result.path!],
      thumbnails: [...(current.thumbnails ?? []), result.path!],
      coverImage: current.coverImage ?? result.path,
      imageType: "photo",
    }));
    event.target.value = "";
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const endpoint = productId ? `/api/products/${productId}` : "/api/products";
    const response = await fetch(endpoint, {
      method: productId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...product,
        weightKg: product.weightKg ?? null,
        lengthCm: product.lengthCm ?? null,
        widthCm: product.widthCm ?? null,
        heightCm: product.heightCm ?? null,
        active: product.status === "active",
        needsReview: product.needsReview,
      }),
    });
    const saved = await response.json() as Product & { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(saved.error ?? "Não foi possível salvar.");
      return;
    }
    setProduct(saved);
    setMessage("Alterações gravadas no Supabase.");
    if (!productId) router.replace(`/admin/produtos/${saved.id}`);
    router.refresh();
  }

  if (loading) return <div className="admin-panel">Carregando produto...</div>;

  return (
    <>
      {message && <div className="admin-feedback" role="status">{message}</div>}
      <div className="admin-detail-grid product-form-layout">
        <div>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>INFORMAÇÕES</span><h2>Dados principais</h2></div></div>
            <div className="admin-form-grid">
              <label className="span-2">Nome do produto<input value={product.name} onChange={(event) => update("name", event.target.value)} placeholder="Ex.: Tênis 001" /></label>
              <label>Slug<input value={product.slug} onChange={(event) => update("slug", event.target.value)} placeholder="tenis-001" /></label>
              <label>Código<input value={product.code} onChange={(event) => update("code", event.target.value)} placeholder="BSP-PROV-001" /></label>
              <label>Categoria<select value={product.category} onChange={(event) => changeCategory(event.target.value as SellableProductCategory)}><optgroup label="Categorias ativas"><option value="tenis">Tênis</option><option value="calcas">Calças</option><option value="conjuntos">Conjuntos</option></optgroup>{!["tenis", "calcas", "conjuntos"].includes(product.category) && <optgroup label="Categoria arquivada"><option value={product.category}>{product.category}</option></optgroup>}</select></label>
              <label>Status<select value={product.status ?? "draft"} onChange={(event) => update("status", event.target.value as ProductStatus)}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="draft">Rascunho</option><option value="archived">Arquivado</option></select></label>
              <label className="span-2">Descrição<textarea rows={5} value={product.description} onChange={(event) => update("description", event.target.value)} /></label>
            </div>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>VARIAÇÕES</span><h2>Tamanhos e cores</h2></div></div>
            <div className="admin-form-grid">
              <label>Tamanhos<input value={product.sizes.join(", ")} onChange={(event) => update("sizes", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
              <label>Cores<input value={product.colors.join(", ")} onChange={(event) => update("colors", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
            </div>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>ENVIO</span><h2>Peso e dimensões</h2></div></div>
            <p className="admin-section-note">Os padrões são preenchidos somente quando o campo está vazio. Todos os valores permanecem editáveis por produto.</p>
            <div className="admin-form-grid shipping-dimensions-grid">
              <label>Peso (kg)<input type="number" min="0" step="0.01" value={product.weightKg ?? ""} onChange={(event) => update("weightKg", event.target.value ? Number(event.target.value) : undefined)} placeholder={String(defaultsForCategory(product.category)?.weightKg ?? "")} /></label>
              <label>Comprimento (cm)<input type="number" min="0" step="0.1" value={product.lengthCm ?? ""} onChange={(event) => update("lengthCm", event.target.value ? Number(event.target.value) : undefined)} placeholder={String(defaultsForCategory(product.category)?.lengthCm ?? "")} /></label>
              <label>Largura (cm)<input type="number" min="0" step="0.1" value={product.widthCm ?? ""} onChange={(event) => update("widthCm", event.target.value ? Number(event.target.value) : undefined)} placeholder={String(defaultsForCategory(product.category)?.widthCm ?? "")} /></label>
              <label>Altura (cm)<input type="number" min="0" step="0.1" value={product.heightCm ?? ""} onChange={(event) => update("heightCm", event.target.value ? Number(event.target.value) : undefined)} placeholder={String(defaultsForCategory(product.category)?.heightCm ?? "")} /></label>
              <label className="span-2">Categoria de embalagem<select value={product.packagingCategory ?? "a-definir"} onChange={(event) => update("packagingCategory", event.target.value as PackagingCategory)}><option value="caixa-tenis">Caixa para tênis</option><option value="pacote-roupa">Pacote para roupa</option><option value="caixa-conjunto">Caixa para conjunto</option><option value="a-definir">A definir</option></select></label>
            </div>
            <label className="admin-toggle shipping-enabled-toggle"><input type="checkbox" checked={product.shippingEnabled ?? false} onChange={(event) => update("shippingEnabled", event.target.checked)} /> Permite envio</label>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>GALERIA</span><h2>Imagens e ordem</h2></div></div>
            <div className="admin-image-grid">
              {product.images.map((image, index) => (
                <article key={`${image}-${index}`} className={product.coverImage === image ? "admin-image-card is-cover" : "admin-image-card"}>
                  <div><Image src={image} alt={`Imagem ${index + 1} de ${product.name || "produto"}`} fill sizes="180px" unoptimized /></div>
                  <span>{index + 1}{product.coverImage === image ? " · PRINCIPAL" : ""}</span>
                  <div className="admin-image-actions">
                    <button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="Mover imagem para cima"><ArrowUp size={15} /></button>
                    <button type="button" onClick={() => moveImage(index, 1)} disabled={index === product.images.length - 1} aria-label="Mover imagem para baixo"><ArrowDown size={15} /></button>
                    <button type="button" onClick={() => update("coverImage", image)} aria-label="Definir como imagem principal"><Star size={15} /></button>
                    <button type="button" className="is-danger" onClick={() => removeImage(image)} aria-label="Remover imagem"><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
              <label className="upload-placeholder admin-upload-control">
                <ImagePlus size={28} /><strong>Adicionar imagem</strong><span>JPG, PNG, WEBP ou AVIF</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void upload(event)} />
              </label>
            </div>
          </section>
        </div>
        <aside>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>PREÇO & ESTOQUE</span><h2>Comercial</h2></div></div>
            <label>Preço<input type="number" step="0.01" value={product.price} onChange={(event) => update("price", Number(event.target.value))} /></label>
            <label>Preço promocional<input type="number" step="0.01" value={product.promotionalPrice ?? ""} onChange={(event) => update("promotionalPrice", event.target.value ? Number(event.target.value) : undefined)} /></label>
            <label>Estoque<input type="number" value={product.stock} onChange={(event) => update("stock", Number(event.target.value))} /></label>
            <div className="admin-checks">
              <label><input type="checkbox" checked={product.featured} onChange={(event) => update("featured", event.target.checked)} /> Produto em destaque</label>
              <label><input type="checkbox" checked={product.isNew} onChange={(event) => update("isNew", event.target.checked)} /> Marcar como lançamento</label>
              <label><input type="checkbox" checked={product.needsReview ?? false} onChange={(event) => update("needsReview", event.target.checked)} /> Cadastro pendente de revisão</label>
            </div>
          </section>
          <div className="local-persistence-note"><strong>Persistência Supabase</strong><span>Produtos, variantes e associações de imagem são salvos no Postgres; os arquivos são enviados ao Storage. Todas as alterações exigem perfil administrativo.</span></div>
          <button type="button" className="button button--red button--full" onClick={() => void save()} disabled={saving}><Save size={18} /> {saving ? "Salvando..." : "Salvar alterações"}</button>
        </aside>
      </div>
    </>
  );
}
