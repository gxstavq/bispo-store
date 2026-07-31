"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Save, Search, Star, Trash2 } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultsForCategory } from "@/lib/product-rules";
import { productCompleteness } from "@/lib/products/completeness";
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
  imagesConfirmed: false,
  demo: true,
  imageType: "photo",
  visual: { accent: "#ef2b35", secondary: "#f7f7f4", type: "shoe" },
};

type AlbumImage = {
  storagePath: string;
  url: string;
  thumbnailUrl: string;
  associationCount: number;
};

export function ProductFormDemo({ productId }: { productId?: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product>(blankProduct);
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [albumImages, setAlbumImages] = useState<AlbumImage[]>([]);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [albumSearch, setAlbumSearch] = useState("");

  useEffect(() => {
    if (!productId) return;
    fetch(`/api/products/${productId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: Product) => setProduct(data))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    fetch("/api/admin/uploads", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { images?: AlbumImage[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Não foi possível carregar o álbum.");
        setAlbumImages(result.images ?? []);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Não foi possível carregar o álbum."))
      .finally(() => setAlbumLoading(false));
  }, []);

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
      return { ...current, images, thumbnails, imagesConfirmed: false, needsReview: true };
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
      imagesConfirmed: false,
      needsReview: true,
    }));
  }

  function selectAlbumImage(image: AlbumImage) {
    setProduct((current) => {
      if (current.images.includes(image.url)) return current;
      return {
        ...current,
        images: [...current.images, image.url],
        thumbnails: [...(current.thumbnails ?? []), image.thumbnailUrl],
        coverImage: current.coverImage ?? image.url,
        imageType: "photo",
        imagesConfirmed: false,
        needsReview: true,
      };
    });
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    setMessage("Enviando imagens...");
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
      const result = await response.json() as { path?: string; thumbnailUrl?: string; storagePath?: string; error?: string };
      if (!response.ok || !result.path || !result.storagePath) {
        setMessage(result.error ?? "Falha no envio da imagem.");
        event.target.value = "";
        return;
      }
      const uploaded: AlbumImage = {
        storagePath: result.storagePath,
        url: result.path,
        thumbnailUrl: result.thumbnailUrl ?? result.path,
        associationCount: 0,
      };
      setAlbumImages((current) => [uploaded, ...current.filter((image) => image.storagePath !== uploaded.storagePath)]);
      selectAlbumImage(uploaded);
    }
    setMessage(`${files.length} ${files.length === 1 ? "imagem enviada" : "imagens enviadas"}. Confirme a seleção antes de salvar.`);
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
        imagesConfirmed: product.imagesConfirmed,
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

  const completeness = productCompleteness(product);
  const normalizedAlbumSearch = albumSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleAlbumImages = normalizedAlbumSearch
    ? albumImages.filter((image) => image.storagePath.toLocaleLowerCase("pt-BR").includes(normalizedAlbumSearch))
    : albumImages;

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
                  <div><Image src={image} alt={`Imagem ${index + 1} de ${product.name || "produto"}`} fill sizes="180px" quality={75} /></div>
                  <span>{index + 1}{product.coverImage === image ? " · PRINCIPAL" : ""}</span>
                  <div className="admin-image-actions">
                    <button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="Mover imagem para cima"><ArrowUp size={15} /></button>
                    <button type="button" onClick={() => moveImage(index, 1)} disabled={index === product.images.length - 1} aria-label="Mover imagem para baixo"><ArrowDown size={15} /></button>
                    <button type="button" onClick={() => setProduct((current) => ({ ...current, coverImage: image, imagesConfirmed: false, needsReview: true }))} aria-label="Definir como imagem principal"><Star size={15} /></button>
                    <button type="button" className="is-danger" onClick={() => removeImage(image)} aria-label="Remover imagem somente deste produto"><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
              <label className="upload-placeholder admin-upload-control">
                <ImagePlus size={28} /><strong>Adicionar imagens</strong><span>JPG, PNG, WEBP ou AVIF · máximo 12 MB cada</span>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void upload(event)} />
              </label>
            </div>
            <p className="admin-section-note">Remover aqui desfaz somente a associação com este produto. O arquivo permanece no álbum.</p>
            <label className="admin-toggle admin-image-confirmation">
              <input
                type="checkbox"
                checked={product.imagesConfirmed ?? false}
                disabled={!product.images.length}
                onChange={(event) => setProduct((current) => ({
                  ...current,
                  imagesConfirmed: event.target.checked,
                  needsReview: event.target.checked ? current.needsReview : true,
                }))}
              />
              Confirmo que as imagens selecionadas pertencem a este produto e estão na ordem correta
            </label>
          </section>
          <section className="admin-panel admin-form-section admin-album-section">
            <div className="admin-panel__header">
              <div><span>FOTOS BISPO STORE</span><h2>Álbum de imagens</h2></div>
              <strong>{albumImages.length} arquivos</strong>
            </div>
            <p className="admin-section-note">Selecione somente as fotos que pertencem a este produto. Nenhuma associação é feita automaticamente.</p>
            <label className="admin-album-search">
              <Search size={17} />
              <input value={albumSearch} onChange={(event) => setAlbumSearch(event.target.value)} placeholder="Buscar pelo nome do arquivo" />
            </label>
            {albumLoading ? (
              <p className="admin-section-note">Carregando o álbum...</p>
            ) : (
              <div className="admin-album-grid">
                {visibleAlbumImages.map((image) => {
                  const selected = product.images.includes(image.url);
                  return (
                    <button
                      type="button"
                      key={image.storagePath}
                      className={selected ? "admin-album-card is-selected" : "admin-album-card"}
                      onClick={() => selectAlbumImage(image)}
                      disabled={selected}
                    >
                      <span className="admin-album-card__visual"><Image src={image.thumbnailUrl} alt="" fill sizes="(max-width: 700px) 40vw, 140px" quality={65} /></span>
                      <span className="admin-album-card__name" title={image.storagePath}>{image.storagePath.split("/").at(-1)}</span>
                      <span className="admin-album-card__meta">
                        {selected ? <><CheckCircle2 size={13} /> Selecionada</> : image.associationCount ? `Usada em ${image.associationCount} produto(s)` : "Disponível"}
                      </span>
                    </button>
                  );
                })}
                {!visibleAlbumImages.length && <p className="admin-section-note">Nenhuma imagem encontrada.</p>}
              </div>
            )}
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
              <div className={completeness.complete ? "admin-completeness is-complete" : "admin-completeness"}>
                <strong>{completeness.complete ? "Cadastro completo" : "Cadastro pendente"}</strong>
                {completeness.complete
                  ? <span>O produto está pronto para publicação e indexação futura.</span>
                  : <span>Falta: {completeness.missing.join(", ")}.</span>}
              </div>
            </div>
          </section>
          <div className="local-persistence-note"><strong>Persistência Supabase</strong><span>Produtos, variantes e associações de imagem são salvos no Postgres; os arquivos são enviados ao Storage. Todas as alterações exigem perfil administrativo.</span></div>
          <button type="button" className="button button--red button--full" onClick={() => void save()} disabled={saving}><Save size={18} /> {saving ? "Salvando..." : "Salvar alterações"}</button>
        </aside>
      </div>
    </>
  );
}
