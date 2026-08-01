"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Save, Search, Star, Trash2, X } from "lucide-react";
import { ChangeEvent, KeyboardEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAdminDecimal, parseAdminDecimal, uniqueAdminTokens } from "@/lib/admin-product-editor";
import { defaultsForCategory } from "@/lib/product-rules";
import { productCompleteness } from "@/lib/products/completeness";
import type { PackagingCategory, Product, ProductCategoryRecord, ProductStatus, ProductVariant } from "@/types/commerce";

type AlbumImage = { storagePath: string; url: string; thumbnailUrl: string; associationCount: number };
type EditableVariant = ProductVariant & { stockText: string; pendingRemoval?: boolean };

const blankProduct: Product = {
  id: "", name: "", slug: "", code: "", category: "tenis",
  description: "Produto provisório aguardando cadastro", price: 0,
  images: [], thumbnails: [], sizes: ["38", "39", "40", "41", "42"],
  colors: ["A definir"], stock: 0, shippingEnabled: true,
  featured: false, isNew: false, active: false, status: "draft",
  needsReview: true, imagesConfirmed: false, demo: true, imageType: "photo",
  visual: { accent: "#ef2b35", secondary: "#f7f7f4", type: "shoe" },
};

function variantSku(code: string, size: string, color: string, index: number) {
  const clean = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
  return `${clean(code)}-${clean(size)}-${clean(color)}-${index + 1}`;
}

function reconcileVariants(current: EditableVariant[], sizes: string[], colors: string[], code: string) {
  const desired = sizes.flatMap((size) => colors.map((color) => ({ size, color })));
  const next = desired.map((item, index) => {
    const existing = current.find((variant) => variant.size.toLocaleLowerCase("pt-BR") === item.size.toLocaleLowerCase("pt-BR") && variant.color.toLocaleLowerCase("pt-BR") === item.color.toLocaleLowerCase("pt-BR"));
    return existing ? { ...existing, pendingRemoval: false } : {
      sku: variantSku(code || "BSP", item.size, item.color, index),
      size: item.size, color: item.color, stock: 0, stockText: "", active: true,
    };
  });
  const removed = current.filter((variant) => variant.id && !desired.some((item) => item.size.toLocaleLowerCase("pt-BR") === variant.size.toLocaleLowerCase("pt-BR") && item.color.toLocaleLowerCase("pt-BR") === variant.color.toLocaleLowerCase("pt-BR")))
    .map((variant) => ({ ...variant, active: false, pendingRemoval: true }));
  return [...next, ...removed];
}

function TagInput({ label, values, onChange, placeholder }: {
  label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  function commit(raw = draft) {
    const additions = uniqueAdminTokens(raw.split(","));
    if (additions.length) onChange(uniqueAdminTokens([...values, ...additions]));
    setDraft("");
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault(); commit();
    }
  }
  return <label className="span-2">{label}
    <div className="tag-editor">
      <div className="tag-editor__chips">{values.map((value) => <span key={value}>{value}<button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remover ${value}`}><X size={13} /></button></span>)}</div>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} onBlur={() => draft.trim() && commit()} placeholder={placeholder} />
    </div>
  </label>;
}

export function ProductFormDemo({ productId }: { productId?: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product>(blankProduct);
  const [variants, setVariants] = useState<EditableVariant[]>(() => reconcileVariants([], blankProduct.sizes, blankProduct.colors, blankProduct.code));
  const [categories, setCategories] = useState<ProductCategoryRecord[]>([]);
  const [priceText, setPriceText] = useState("");
  const [promotionalText, setPromotionalText] = useState("");
  const [bulkStockText, setBulkStockText] = useState("");
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [albumImages, setAlbumImages] = useState<AlbumImage[]>([]);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [albumSearch, setAlbumSearch] = useState("");

  useEffect(() => {
    const requests: Promise<unknown>[] = [
      fetch("/api/admin/categories", { cache: "no-store" }).then(async (response) => {
        const result = await response.json() as { categories?: ProductCategoryRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Não foi possível carregar as categorias.");
        setCategories(result.categories ?? []);
      }),
      fetch("/api/admin/uploads", { cache: "no-store" }).then(async (response) => {
        const result = await response.json() as { images?: AlbumImage[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Não foi possível carregar o álbum.");
        setAlbumImages(result.images ?? []);
      }).finally(() => setAlbumLoading(false)),
    ];
    if (productId) requests.push(fetch(`/api/products/${productId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as Product & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar o produto.");
      setProduct(data);
      setPriceText(formatAdminDecimal(data.price));
      setPromotionalText(formatAdminDecimal(data.promotionalPrice));
      setVariants((data.variants ?? []).map((variant) => ({ ...variant, stockText: String(variant.stock) })));
    }));
    Promise.all(requests).catch((error: unknown) => {
      setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Não foi possível carregar o formulário.");
    }).finally(() => setLoading(false));
  }, [productId]);

  const activeVariants = variants.filter((variant) => !variant.pendingRemoval);
  const totalStock = activeVariants.filter((variant) => variant.active).reduce((sum, variant) => sum + (Number.isInteger(Number(variant.stockText)) ? Number(variant.stockText) : 0), 0);
  const parsedPrice = parseAdminDecimal(priceText);
  const completeness = productCompleteness({ ...product, price: typeof parsedPrice === "number" && Number.isFinite(parsedPrice) ? parsedPrice : 0, stock: totalStock });
  const normalizedAlbumSearch = albumSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleAlbumImages = normalizedAlbumSearch ? albumImages.filter((image) => image.storagePath.toLocaleLowerCase("pt-BR").includes(normalizedAlbumSearch)) : albumImages;

  const update = <K extends keyof Product>(key: K, value: Product[K]) => setProduct((current) => ({ ...current, [key]: value }));
  function updateTags(key: "sizes" | "colors", values: string[]) {
    const sizes = key === "sizes" ? values : product.sizes;
    const colors = key === "colors" ? values : product.colors;
    update(key, values);
    setVariants((current) => reconcileVariants(current, sizes, colors, product.code));
  }
  function changeCategory(category: string) {
    const defaults = defaultsForCategory(category);
    setProduct((current) => ({ ...current, category, weightKg: current.weightKg ?? defaults?.weightKg, lengthCm: current.lengthCm ?? defaults?.lengthCm, widthCm: current.widthCm ?? defaults?.widthCm, heightCm: current.heightCm ?? defaults?.heightCm, packagingCategory: current.packagingCategory ?? defaults?.packagingCategory }));
  }
  function moveImage(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= product.images.length) return;
    setProduct((current) => {
      const images = [...current.images]; [images[index], images[destination]] = [images[destination], images[index]];
      const thumbnails = current.thumbnails ? [...current.thumbnails] : undefined;
      if (thumbnails && thumbnails.length === images.length) [thumbnails[index], thumbnails[destination]] = [thumbnails[destination], thumbnails[index]];
      return { ...current, images, thumbnails, imagesConfirmed: false, needsReview: true };
    });
  }
  function removeImage(image: string) {
    setProduct((current) => ({ ...current, images: current.images.filter((candidate) => candidate !== image), thumbnails: current.thumbnails?.filter((_, index) => current.images[index] !== image), coverImage: current.coverImage === image ? current.images.filter((candidate) => candidate !== image)[0] : current.coverImage, imagesConfirmed: false, needsReview: true }));
  }
  function selectAlbumImage(image: AlbumImage) {
    setProduct((current) => current.images.includes(image.url) ? current : ({ ...current, images: [...current.images, image.url], thumbnails: [...(current.thumbnails ?? []), image.thumbnailUrl], coverImage: current.coverImage ?? image.url, imageType: "photo", imagesConfirmed: false, needsReview: true }));
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    setMessageTone("success"); setMessage("Enviando imagens...");
    for (const file of files) {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
      const result = await response.json() as { path?: string; thumbnailUrl?: string; storagePath?: string; error?: string };
      if (!response.ok || !result.path || !result.storagePath) {
        setMessageTone("error"); setMessage(result.error ?? "Falha no envio da imagem."); event.target.value = ""; return;
      }
      const uploaded = { storagePath: result.storagePath, url: result.path, thumbnailUrl: result.thumbnailUrl ?? result.path, associationCount: 0 };
      setAlbumImages((current) => [uploaded, ...current.filter((image) => image.storagePath !== uploaded.storagePath)]);
      selectAlbumImage(uploaded);
    }
    setMessageTone("success"); setMessage(`${files.length} ${files.length === 1 ? "imagem enviada" : "imagens enviadas"}. Confirme a seleção antes de salvar.`);
    event.target.value = "";
  }
  function normalizeDecimal(field: "price" | "promotional") {
    const value = parseAdminDecimal(field === "price" ? priceText : promotionalText);
    if (value === null || !Number.isFinite(value)) return;
    if (field === "price") setPriceText(formatAdminDecimal(value)); else setPromotionalText(formatAdminDecimal(value));
  }
  function updateVariant(index: number, updateValue: Partial<EditableVariant>) {
    setVariants((current) => current.map((variant, currentIndex) => currentIndex === index ? { ...variant, ...updateValue } : variant));
  }
  function applyBulkStock() {
    if (!/^\d+$/.test(bulkStockText)) { setMessageTone("error"); setMessage("Informe um estoque inteiro igual ou maior que zero."); return; }
    setVariants((current) => current.map((variant) => variant.pendingRemoval ? variant : ({ ...variant, stock: Number(bulkStockText), stockText: bulkStockText })));
  }

  async function save() {
    setMessage("");
    const price = parseAdminDecimal(priceText);
    const promotionalPrice = parseAdminDecimal(promotionalText);
    if (price === null || !Number.isFinite(price) || price < 0) { setMessageTone("error"); setMessage("Informe um preço normal válido."); return; }
    if (promotionalPrice !== null && (!Number.isFinite(promotionalPrice) || promotionalPrice < 0 || promotionalPrice >= price)) { setMessageTone("error"); setMessage("O preço promocional deve ser positivo e menor que o preço normal."); return; }
    const variantsToSave = activeVariants.map((variant) => ({ ...variant, stock: Number(variant.stockText) }));
    if (variantsToSave.some((variant) => !/^\d+$/.test(variant.stockText) || !Number.isInteger(variant.stock) || variant.stock < 0)) { setMessageTone("error"); setMessage("Todos os estoques devem ser números inteiros iguais ou maiores que zero."); return; }
    const candidate: Product = { ...product, price, promotionalPrice: promotionalPrice ?? undefined, stock: totalStock, variants: variantsToSave, active: product.status === "active" };
    const review = productCompleteness(candidate);
    setSaving(true);
    const response = await fetch(productId ? `/api/products/${productId}` : "/api/products", {
      method: productId ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...candidate, needsReview: !review.complete }),
    });
    const saved = await response.json() as Product & { error?: string };
    setSaving(false);
    if (!response.ok) { setMessageTone("error"); setMessage(saved.error ?? "Não foi possível salvar."); return; }
    setProduct(saved); setPriceText(formatAdminDecimal(saved.price)); setPromotionalText(formatAdminDecimal(saved.promotionalPrice));
    setVariants((saved.variants ?? []).map((variant) => ({ ...variant, stockText: String(variant.stock) })));
    setMessageTone("success"); setMessage("Alterações gravadas no Supabase e produto recarregado.");
    if (!productId) router.replace(`/admin/produtos/${saved.id}`);
    router.refresh();
  }

  if (loading) return <div className="admin-panel">Carregando produto...</div>;
  return <>
    {message && <div className={`admin-feedback is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</div>}
    <div className="admin-detail-grid product-form-layout"><div>
      <section className="admin-panel admin-form-section"><div className="admin-panel__header"><div><span>INFORMAÇÕES</span><h2>Dados principais</h2></div></div><div className="admin-form-grid">
        <label className="span-2">Nome do produto<input value={product.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label>Slug<input value={product.slug} onChange={(event) => update("slug", event.target.value)} /></label>
        <label>Código<input value={product.code} onChange={(event) => update("code", event.target.value)} /></label>
        <label>Categoria<select value={product.category} onChange={(event) => changeCategory(event.target.value)}>{categories.map((category) => <option value={category.slug} key={category.id}>{category.name}{category.active ? "" : " (arquivada)"}</option>)}</select></label>
        <label>Status<select value={product.status ?? "draft"} onChange={(event) => update("status", event.target.value as ProductStatus)}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="draft">Rascunho</option><option value="archived">Arquivado</option></select></label>
        <label className="span-2">Descrição<textarea rows={5} value={product.description} onChange={(event) => update("description", event.target.value)} /></label>
      </div></section>
      <section className="admin-panel admin-form-section"><div className="admin-panel__header"><div><span>VARIAÇÕES</span><h2>Tamanhos, cores e variantes</h2></div></div><div className="admin-form-grid">
        <TagInput label="Tamanhos" values={product.sizes} onChange={(sizes) => updateTags("sizes", sizes)} placeholder="Digite 34, P ou GG e pressione Enter" />
        <TagInput label="Cores" values={product.colors} onChange={(colors) => updateTags("colors", colors)} placeholder="Digite Off-white e pressione Enter" />
      </div>
      <div className="variant-bulk"><label>Estoque em massa<input inputMode="numeric" value={bulkStockText} onChange={(event) => setBulkStockText(event.target.value)} placeholder="Quantidade por combinação" /></label><button type="button" className="button button--dark" onClick={applyBulkStock}>Aplicar</button></div>
      <div className="admin-table-wrap"><table className="admin-table variant-table"><thead><tr><th>Tamanho</th><th>Cor</th><th>Situação</th><th>Ativa</th><th>Estoque</th></tr></thead><tbody>{variants.map((variant, index) => <tr key={`${variant.id ?? "new"}-${variant.size}-${variant.color}`} className={variant.pendingRemoval ? "is-muted" : ""}><td>{variant.size}</td><td>{variant.color}</td><td><span className="review-badge">{variant.pendingRemoval ? "Será removida/desativada" : variant.id ? "Mantida — ID preservado" : "Será criada"}</span></td><td><input type="checkbox" checked={variant.active && !variant.pendingRemoval} disabled={variant.pendingRemoval} onChange={(event) => updateVariant(index, { active: event.target.checked })} aria-label={`Ativar ${variant.size} ${variant.color}`} /></td><td><input inputMode="numeric" value={variant.stockText} disabled={variant.pendingRemoval} onChange={(event) => updateVariant(index, { stockText: event.target.value })} onBlur={() => { if (/^\d+$/.test(variant.stockText)) updateVariant(index, { stockText: String(Number(variant.stockText)) }); }} aria-label={`Estoque ${variant.size} ${variant.color}`} /></td></tr>)}</tbody></table></div>
      </section>
      <section className="admin-panel admin-form-section"><div className="admin-panel__header"><div><span>ENVIO</span><h2>Peso e dimensões</h2></div></div><div className="admin-form-grid shipping-dimensions-grid">
        <label>Peso (kg)<input type="number" min="0" step="0.01" value={product.weightKg ?? ""} onChange={(event) => update("weightKg", event.target.value ? Number(event.target.value) : undefined)} /></label>
        <label>Comprimento (cm)<input type="number" min="0" step="0.1" value={product.lengthCm ?? ""} onChange={(event) => update("lengthCm", event.target.value ? Number(event.target.value) : undefined)} /></label>
        <label>Largura (cm)<input type="number" min="0" step="0.1" value={product.widthCm ?? ""} onChange={(event) => update("widthCm", event.target.value ? Number(event.target.value) : undefined)} /></label>
        <label>Altura (cm)<input type="number" min="0" step="0.1" value={product.heightCm ?? ""} onChange={(event) => update("heightCm", event.target.value ? Number(event.target.value) : undefined)} /></label>
        <label className="span-2">Categoria de embalagem<select value={product.packagingCategory ?? "a-definir"} onChange={(event) => update("packagingCategory", event.target.value as PackagingCategory)}><option value="caixa-tenis">Caixa para tênis</option><option value="pacote-roupa">Pacote para roupa</option><option value="caixa-conjunto">Caixa para conjunto</option><option value="a-definir">A definir</option></select></label>
      </div><label className="admin-toggle"><input type="checkbox" checked={product.shippingEnabled ?? false} onChange={(event) => update("shippingEnabled", event.target.checked)} /> Permite envio</label></section>
      <section className="admin-panel admin-form-section"><div className="admin-panel__header"><div><span>GALERIA</span><h2>Imagens e ordem</h2></div></div><div className="admin-image-grid">{product.images.map((image, index) => <article key={`${image}-${index}`} className={product.coverImage === image ? "admin-image-card is-cover" : "admin-image-card"}><div><Image src={image} alt={`Imagem ${index + 1} de ${product.name || "produto"}`} fill sizes="180px" /></div><span>{index + 1}{product.coverImage === image ? " · PRINCIPAL" : ""}</span><div className="admin-image-actions"><button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="Mover imagem para cima"><ArrowUp size={15} /></button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === product.images.length - 1} aria-label="Mover imagem para baixo"><ArrowDown size={15} /></button><button type="button" onClick={() => setProduct((current) => ({ ...current, coverImage: image, imagesConfirmed: false, needsReview: true }))} aria-label="Definir como imagem principal"><Star size={15} /></button><button type="button" className="is-danger" onClick={() => removeImage(image)} aria-label="Remover imagem somente deste produto"><Trash2 size={15} /></button></div></article>)}<label className="upload-placeholder admin-upload-control"><ImagePlus size={28} /><strong>Adicionar imagens</strong><span>JPG, PNG, WEBP ou AVIF · máximo 12 MB</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void upload(event)} /></label></div>
      <p className="admin-section-note">Remover aqui desfaz somente a associação. O arquivo permanece no álbum quando estiver em uso.</p><label className="admin-toggle admin-image-confirmation"><input type="checkbox" checked={product.imagesConfirmed ?? false} disabled={!product.images.length} onChange={(event) => setProduct((current) => ({ ...current, imagesConfirmed: event.target.checked, needsReview: event.target.checked ? current.needsReview : true }))} /> Confirmo que as imagens pertencem a este produto e estão na ordem correta</label></section>
      <section className="admin-panel admin-form-section admin-album-section"><div className="admin-panel__header"><div><span>FOTOS BISPO STORE</span><h2>Álbum de imagens</h2></div><strong>{albumImages.length} arquivos</strong></div><label className="admin-album-search"><Search size={17} /><input value={albumSearch} onChange={(event) => setAlbumSearch(event.target.value)} placeholder="Buscar pelo nome do arquivo" /></label>{albumLoading ? <p>Carregando...</p> : <div className="admin-album-grid">{visibleAlbumImages.map((image) => { const selected = product.images.includes(image.url); return <button type="button" key={image.storagePath} className={selected ? "admin-album-card is-selected" : "admin-album-card"} onClick={() => selectAlbumImage(image)} disabled={selected}><span className="admin-album-card__visual"><Image src={image.thumbnailUrl} alt="" fill sizes="140px" /></span><span className="admin-album-card__name">{image.storagePath.split("/").at(-1)}</span><span className="admin-album-card__meta">{selected ? <><CheckCircle2 size={13} /> Selecionada</> : image.associationCount ? `Usada em ${image.associationCount} produto(s)` : "Disponível"}</span></button>; })}</div>}</section>
    </div><aside><section className="admin-panel admin-form-section"><div className="admin-panel__header"><div><span>PREÇO & ESTOQUE</span><h2>Comercial</h2></div></div>
      <label>Preço normal<input inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} onBlur={() => normalizeDecimal("price")} placeholder="149,90" /></label>
      <label>Preço promocional<input inputMode="decimal" value={promotionalText} onChange={(event) => setPromotionalText(event.target.value)} onBlur={() => normalizeDecimal("promotional")} placeholder="Opcional" /></label>
      <label>Estoque total<input value={String(totalStock)} readOnly /></label>
      <div className="admin-checks"><label><input type="checkbox" checked={product.featured} onChange={(event) => update("featured", event.target.checked)} /> Produto em destaque</label><label><input type="checkbox" checked={product.isNew} onChange={(event) => update("isNew", event.target.checked)} /> Marcar como lançamento</label><div className={completeness.complete ? "admin-completeness is-complete" : "admin-completeness"}><strong>{completeness.complete ? "Cadastro completo" : "Cadastro pendente"}</strong><span>{completeness.complete ? "Pronto para publicação." : `Falta: ${completeness.missing.join(", ")}.`}</span></div></div>
    </section><div className="local-persistence-note"><strong>Salvamento transacional</strong><span>Produto, imagens e variantes são gravados juntos. IDs existentes são preservados e qualquer erro desfaz a operação inteira.</span></div><button type="button" className="button button--red button--full" onClick={() => void save()} disabled={saving}><Save size={18} /> {saving ? "Salvando..." : "Salvar alterações"}</button></aside></div>
  </>;
}
