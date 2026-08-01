"use client";

import { Download, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

type VariantRow = { id: string; sku: string; size: string; color: string; stock: number; active: boolean; product: { id: string; name: string; code: string; status: string } };
type Operation = "add" | "remove" | "set";

export function InventoryManager({ initial }: { initial: VariantRow[] }) {
  const [variants, setVariants] = useState(initial);
  const [selected, setSelected] = useState<VariantRow | null>(null);
  const [operation, setOperation] = useState<Operation>("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error">("success");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const visible = useMemo(() => variants.filter((variant) => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (!lowOnly || variant.stock <= 5) && (!term || `${variant.product.name} ${variant.product.code} ${variant.sku} ${variant.size} ${variant.color}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [variants, search, lowOnly]);

  function open(row: VariantRow) {
    setSelected(row); setOperation("add"); setQuantity(""); setReason(""); setNote(""); setIdempotencyKey(crypto.randomUUID());
  }
  async function apply() {
    if (!selected) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/admin/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: selected.id, operation, quantity, reason, note, idempotencyKey }) });
    const result = await response.json() as { variants?: VariantRow[]; result?: { previous_stock?: number; new_stock?: number; duplicate?: boolean }; error?: string };
    setSaving(false);
    if (!response.ok || !result.variants) { setTone("error"); setMessage(result.error ?? "Não foi possível ajustar o estoque."); return; }
    setVariants(result.variants); setSelected(null); setTone("success");
    setMessage(`Estoque atualizado de ${result.result?.previous_stock} para ${result.result?.new_stock}${result.result?.duplicate ? " (requisição já processada)" : ""}.`);
  }
  function exportCsv() {
    const lines = [["Produto", "Código", "SKU", "Tamanho", "Cor", "Estoque"], ...visible.map((variant) => [variant.product.name, variant.product.code, variant.sku, variant.size, variant.color, String(variant.stock)])];
    const csv = lines.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "estoque-bispo-store.csv"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <>
    <div className="admin-page-actions"><button type="button" className="button button--dark" onClick={exportCsv}><Download size={18} /> Exportar relatório</button></div>
    {message && <div className={`admin-feedback is-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</div>}
    <div className="admin-toolbar"><div className="admin-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por produto, tamanho, cor ou SKU..." /></div><label className="admin-toggle"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /> Apenas baixo estoque</label></div>
    <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Produto</th><th>SKU</th><th>Variante</th><th>Estoque</th><th>Status</th><th>Ação</th></tr></thead><tbody>{visible.map((variant) => <tr key={variant.id}><td><strong>{variant.product.name}</strong><small>{variant.product.code}</small></td><td>{variant.sku}</td><td>{variant.size} · {variant.color}</td><td><strong className={variant.stock <= 5 ? "stock-low" : ""}>{variant.stock} un.</strong></td><td><span className={`status-badge ${variant.active ? "status-active" : "status-inactive"}`}>{variant.active ? "Ativa" : "Inativa"}</span></td><td><button type="button" className="table-button" onClick={() => open(variant)}>Ajustar</button></td></tr>)}</tbody></table></div></section>
    {selected && <div className="admin-modal-backdrop" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-label="Ajustar estoque"><div className="admin-panel__header"><div><span>AJUSTE DE ESTOQUE</span><h2>{selected.product.name}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X /></button></div><p><strong>{selected.size} · {selected.color}</strong><br />Estoque atual: {selected.stock}</p><div className="admin-form-grid"><label>Operação<select value={operation} onChange={(event) => setOperation(event.target.value as Operation)}><option value="add">Adicionar</option><option value="remove">Remover</option><option value="set">Definir quantidade</option></select></label><label>Quantidade<input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="span-2">Motivo obrigatório<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="span-2">Observação opcional<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label></div><div className="decision-actions"><button type="button" className="button button--dark" onClick={() => setSelected(null)}>Cancelar</button><button type="button" className="button button--red" disabled={saving || !/^\d+$/.test(quantity) || reason.trim().length < 3} onClick={() => void apply()}>{saving ? "Processando..." : "Confirmar ajuste"}</button></div></section></div>}
  </>;
}
