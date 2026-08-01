"use client";

import Image from "next/image";
import { Archive, FolderPlus, Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductCategoryRecord } from "@/types/commerce";

type AlbumImage = { storagePath: string; url: string; thumbnailUrl: string };
const blank: ProductCategoryRecord = { id: "", slug: "", name: "", active: true, sortOrder: 0 };

export function CategoriesManager({ initial }: { initial: ProductCategoryRecord[] }) {
  const [categories, setCategories] = useState(initial);
  const [editing, setEditing] = useState<ProductCategoryRecord | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [album, setAlbum] = useState<AlbumImage[]>([]);
  const [replacementId, setReplacementId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProductCategoryRecord | null>(null);

  useEffect(() => {
    if (!editing) return;
    fetch("/api/admin/uploads", { cache: "no-store" }).then((response) => response.json())
      .then((result: { images?: AlbumImage[] }) => setAlbum(result.images ?? []))
      .catch(() => setAlbum([]));
  }, [editing]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/admin/categories", {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const result = await response.json() as { categories?: ProductCategoryRecord[]; error?: string };
    setSaving(false);
    if (!response.ok || !result.categories) {
      setTone("error"); setMessage(result.error ?? "Não foi possível salvar a categoria."); return;
    }
    setCategories(result.categories);
    setEditing(null);
    setTone("success"); setMessage("Categoria salva com sucesso.");
  }

  async function archiveOrDelete(category: ProductCategoryRecord, permanent: boolean) {
    setSaving(true);
    const response = permanent
      ? await fetch("/api/admin/categories", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: category.id, replacementId: replacementId || undefined }),
      })
      : await fetch("/api/admin/categories", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...category, active: false }),
      });
    const result = await response.json() as { categories?: ProductCategoryRecord[]; result?: { archived?: boolean; reassigned?: number }; error?: string };
    setSaving(false);
    if (!response.ok || !result.categories) {
      setTone("error"); setMessage(result.error ?? "Não foi possível concluir a ação."); return;
    }
    setCategories(result.categories);
    setDeleteTarget(null);
    setReplacementId("");
    setTone("success");
    setMessage(result.result?.archived ? "A categoria possui produtos e foi arquivada para preservar os dados." : "Categoria atualizada com segurança.");
  }

  return <>
    <div className="admin-page-actions">
      <button type="button" className="button button--red" onClick={() => setEditing({ ...blank })}><FolderPlus size={17} /> Nova categoria</button>
    </div>
    {message && <div className={`admin-feedback is-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</div>}
    <div className="category-admin-grid">
      {categories.map((category) => <article className="admin-panel category-admin-card" key={category.id}>
        {category.imageUrl && <div className="category-admin-image"><Image src={category.imageUrl} alt="" fill sizes="220px" /></div>}
        <h2>{category.name}</h2>
        <p>/{category.slug} · {category.productCount ?? 0} produto(s)</p>
        <div><span className={`status-badge ${category.active ? "status-active" : "status-archived"}`}>{category.active ? "Ativa" : "Arquivada"}</span>
          <div className="product-actions">
            <button type="button" onClick={() => { setEditing({ ...category }); setReplacementId(""); }} aria-label={`Editar ${category.name}`}><Pencil size={16} /></button>
            {category.active && <button type="button" onClick={() => void archiveOrDelete(category, false)} aria-label={`Arquivar ${category.name}`}><Archive size={16} /></button>}
            <button type="button" className="is-danger" onClick={() => { setDeleteTarget(category); setReplacementId(""); }} aria-label={`Excluir ${category.name}`}><Trash2 size={16} /></button>
          </div>
        </div>
      </article>)}
    </div>
    {editing && <div className="admin-modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-label={editing.id ? "Editar categoria" : "Nova categoria"}>
        <div className="admin-panel__header"><div><span>CATEGORIA</span><h2>{editing.id ? "Editar categoria" : "Nova categoria"}</h2></div><button type="button" onClick={() => setEditing(null)} aria-label="Fechar"><X /></button></div>
        <div className="admin-form-grid">
          <label>Nome<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Slug<input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} /></label>
          <label className="span-2">Descrição<textarea rows={3} value={editing.description ?? ""} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
          <label>Ordem<input type="number" min="0" value={editing.sortOrder} onChange={(event) => setEditing({ ...editing, sortOrder: Number(event.target.value) || 0 })} /></label>
          <label className="admin-toggle"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> Categoria ativa</label>
          <label className="span-2">URL da imagem<input value={editing.imageUrl ?? ""} onChange={(event) => setEditing({ ...editing, imageUrl: event.target.value })} /></label>
        </div>
        {album.length > 0 && <div className="admin-album-grid compact">{album.map((image) => <button type="button" className={editing.imageUrl === image.url ? "admin-album-card is-selected" : "admin-album-card"} key={image.storagePath} onClick={() => setEditing({ ...editing, imageUrl: image.url })}><span className="admin-album-card__visual"><Image src={image.thumbnailUrl} alt="" fill sizes="100px" /></span></button>)}</div>}
        <div className="decision-actions"><button type="button" className="button button--dark" onClick={() => setEditing(null)}>Cancelar</button><button type="button" className="button button--red" disabled={saving} onClick={() => void save()}><Save size={17} /> {saving ? "Salvando..." : "Salvar"}</button></div>
      </section>
    </div>}
    {deleteTarget && <div className="admin-modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-label={`Excluir ${deleteTarget.name}`}>
        <div className="admin-panel__header"><div><span>EXCLUSÃO SEGURA</span><h2>{deleteTarget.name}</h2></div><button type="button" onClick={() => setDeleteTarget(null)} aria-label="Fechar"><X /></button></div>
        {(deleteTarget.productCount ?? 0) > 0 ? <>
          <p>Esta categoria possui {deleteTarget.productCount} produto(s). Escolha outra categoria para reatribuir e excluir, ou deixe sem seleção para apenas arquivar.</p>
          <label>Categoria de destino<select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">Arquivar sem reatribuir</option>{categories.filter((item) => item.id !== deleteTarget.id && item.active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        </> : <p>A categoria não possui produtos e pode ser excluída definitivamente.</p>}
        <div className="decision-actions"><button type="button" className="button button--dark" onClick={() => setDeleteTarget(null)}>Cancelar</button><button type="button" className="button button--outline-danger" disabled={saving} onClick={() => void archiveOrDelete(deleteTarget, true)}>{saving ? "Processando..." : (deleteTarget.productCount ?? 0) > 0 ? replacementId ? "Reatribuir e excluir" : "Arquivar categoria" : "Excluir definitivamente"}</button></div>
      </section>
    </div>}
  </>;
}
