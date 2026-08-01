"use client";

import Image from "next/image";
import { ImagePlus, RotateCcw, Save } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import type { HomeBannerSettings } from "@/types/commerce";

type AlbumImage = { storagePath: string; url: string; thumbnailUrl: string };
const empty: HomeBannerSettings = { desktopImageUrl: "", altText: "", active: false };

export function HomeBannerSettingsPanel({ initial, hasPrevious }: { initial: HomeBannerSettings | null; hasPrevious: boolean }) {
  const [banner, setBanner] = useState(initial ?? empty);
  const [album, setAlbum] = useState<AlbumImage[]>([]);
  const [target, setTarget] = useState<"desktop" | "mobile">("desktop");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [canRestore, setCanRestore] = useState(hasPrevious);

  useEffect(() => { fetch("/api/admin/uploads", { cache: "no-store" }).then((response) => response.json()).then((result: { images?: AlbumImage[] }) => setAlbum(result.images ?? [])).catch(() => setAlbum([])); }, []);
  function choose(url: string) { setBanner((current) => target === "desktop" ? { ...current, desktopImageUrl: url } : { ...current, mobileImageUrl: url }); }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append("file", file);
    const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
    const result = await response.json() as { path?: string; storagePath?: string; thumbnailUrl?: string; error?: string };
    event.target.value = "";
    if (!response.ok || !result.path || !result.storagePath) { setTone("error"); setMessage(result.error ?? "Falha no upload."); return; }
    const item = { storagePath: result.storagePath, url: result.path, thumbnailUrl: result.thumbnailUrl ?? result.path };
    setAlbum((current) => [item, ...current]); choose(item.url); setTone("success"); setMessage("Imagem enviada e selecionada. Salve para publicar.");
  }
  async function save() {
    setSaving(true); setMessage("");
    const response = await fetch("/api/admin/home-banner", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(banner) });
    const result = await response.json() as { banner?: HomeBannerSettings; error?: string };
    setSaving(false);
    if (!response.ok || !result.banner) { setTone("error"); setMessage(result.error ?? "Não foi possível salvar."); return; }
    setBanner(result.banner); setCanRestore(true); setTone("success"); setMessage("Banner salvo e cache da página inicial atualizado.");
  }
  async function restore() {
    setSaving(true);
    const response = await fetch("/api/admin/home-banner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    const result = await response.json() as { banner?: HomeBannerSettings; error?: string };
    setSaving(false);
    if (!response.ok || !result.banner) { setTone("error"); setMessage(result.error ?? "Não foi possível restaurar."); return; }
    setBanner(result.banner); setTone("success"); setMessage("Banner anterior restaurado.");
  }
  return <section className="admin-panel admin-form-section home-banner-admin">
    <div className="admin-panel__header"><div><span>APARÊNCIA → PÁGINA INICIAL</span><h2>Banner principal</h2></div></div>
    {message && <div className={`admin-feedback is-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</div>}
    <div className="home-banner-preview">{banner.desktopImageUrl ? <Image src={banner.desktopImageUrl} alt={banner.altText || "Prévia do banner"} fill sizes="720px" /> : <span>O banner visual atual da coleção será mantido como padrão.</span>}{banner.title && <strong>{banner.title}</strong>}</div>
    <div className="admin-form-grid">
      <label>Imagem em edição<select value={target} onChange={(event) => setTarget(event.target.value as "desktop" | "mobile")}><option value="desktop">Desktop</option><option value="mobile">Mobile (opcional)</option></select></label>
      <label className="admin-toggle"><input type="checkbox" checked={banner.active} onChange={(event) => setBanner({ ...banner, active: event.target.checked })} /> Banner ativo</label>
      <label className="span-2">Texto alternativo<input value={banner.altText} onChange={(event) => setBanner({ ...banner, altText: event.target.value })} /></label>
      <label>Título opcional<input value={banner.title ?? ""} onChange={(event) => setBanner({ ...banner, title: event.target.value })} /></label>
      <label>Link opcional<input value={banner.link ?? ""} onChange={(event) => setBanner({ ...banner, link: event.target.value })} placeholder="/catalogo" /></label>
    </div>
    <label className="upload-placeholder admin-upload-control"><ImagePlus /><strong>Enviar nova imagem</strong><span>Validação de tipo, assinatura e 12 MB no servidor</span><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void upload(event)} /></label>
    <div className="admin-album-grid compact">{album.map((image) => { const selected = target === "desktop" ? banner.desktopImageUrl === image.url : banner.mobileImageUrl === image.url; return <button type="button" className={selected ? "admin-album-card is-selected" : "admin-album-card"} key={image.storagePath} onClick={() => choose(image.url)}><span className="admin-album-card__visual"><Image src={image.thumbnailUrl} alt="" fill sizes="110px" /></span></button>; })}</div>
    <div className="decision-actions"><button type="button" className="button button--dark" disabled={!canRestore || saving} onClick={() => void restore()}><RotateCcw size={17} /> Restaurar anterior</button><button type="button" className="button button--red" disabled={saving || !banner.desktopImageUrl} onClick={() => void save()}><Save size={17} /> Salvar banner</button></div>
  </section>;
}
