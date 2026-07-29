"use client";

import { Save, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { StoreSettings } from "@/types/commerce";

type IntegrationStatus = {
  melhorEnvioSandbox: boolean;
  melhorEnvioConfigured: boolean;
  pagBankSandbox: boolean;
  pagBankConfigured: boolean;
  labelPurchaseEnabled: boolean;
};

export function StoreSettingsForm({
  initial,
  cnpjConfigured,
  integrations,
  melhorEnvio,
}: {
  initial: StoreSettings;
  cnpjConfigured: boolean;
  integrations: IntegrationStatus;
  melhorEnvio: { connected: boolean; expiresAt?: string; unavailable?: boolean };
}) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key: keyof StoreSettings, value: string) =>
    setSettings((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const result = await response.json() as { settings?: StoreSettings; error?: string };
    setSaving(false);
    if (!response.ok || !result.settings) {
      setMessage(result.error ?? "Não foi possível salvar as configurações.");
      return;
    }
    setSettings(result.settings);
    setMessage("Configurações salvas no Supabase.");
  }

  return (
    <>
      {message && <div className="admin-feedback" role="status">{message}</div>}
      <div className="admin-detail-grid settings-layout">
        <div>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>LOJA</span><h2>Informações gerais</h2></div></div>
            <div className="admin-form-grid">
              <label>Nome da loja<input value={settings.storeName} onChange={(e) => update("storeName", e.target.value)} /></label>
              <label>Responsável<input value={settings.ownerName} onChange={(e) => update("ownerName", e.target.value)} /></label>
              <label>E-mail comercial<input type="email" value={settings.commercialEmail} onChange={(e) => update("commercialEmail", e.target.value)} /></label>
              <label>WhatsApp<input value={settings.whatsapp} onChange={(e) => update("whatsapp", e.target.value)} /></label>
            </div>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>ORIGEM</span><h2>Endereço de postagem</h2></div></div>
            <div className="admin-form-grid">
              <label className="span-2">Endereço<input value={settings.originAddress} onChange={(e) => update("originAddress", e.target.value)} /></label>
              <label>CEP de origem<input value={settings.originPostalCode} onChange={(e) => update("originPostalCode", e.target.value)} /></label>
              <label>Estado<select value="SP" disabled><option>São Paulo (SP)</option></select></label>
              <label>Bairro<input value={settings.originDistrict} onChange={(e) => update("originDistrict", e.target.value)} /></label>
              <label>Cidade<input value={settings.originCity} onChange={(e) => update("originCity", e.target.value)} /></label>
              <label>Telefone do remetente<input value={settings.senderPhone} onChange={(e) => update("senderPhone", e.target.value)} /></label>
            </div>
            <p className="settings-note">As cotações usam o CEP operacional 03870-100.</p>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>FISCAL</span><h2>Dados para etiqueta comercial</h2></div></div>
            <div className="admin-form-grid">
              <label>Inscrição estadual<input value={settings.stateRegistration} onChange={(e) => update("stateRegistration", e.target.value)} /></label>
              <label>CNAE<input value={settings.economicActivityCode} onChange={(e) => update("economicActivityCode", e.target.value)} /></label>
              <label className="span-2">Observações fiscais<textarea rows={3} value={settings.fiscalNotes} onChange={(e) => update("fiscalNotes", e.target.value)} /></label>
            </div>
          </section>
        </div>
        <aside>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>DADO PROTEGIDO</span><h2>CNPJ</h2></div></div>
            <div className="protected-setting"><ShieldCheck /><div>
              <strong>{cnpjConfigured ? "Configurado no servidor" : "Ainda não configurado"}</strong>
              <span>Somente <code>STORE_CNPJ</code>; o valor nunca chega ao navegador.</span>
            </div></div>
          </section>
          <section className="admin-panel admin-form-section">
            <div className="admin-panel__header"><div><span>INTEGRAÇÕES</span><h2>Ambiente de testes</h2></div></div>
            <div className="integration-list">
              <div><span><i className="is-demo" /> Melhor Envio</span><strong>{melhorEnvio.unavailable ? "Status indisponível" : melhorEnvio.connected ? "Sandbox conectado" : integrations.melhorEnvioConfigured ? "OAuth pronto" : "Variáveis pendentes"}</strong></div>
              <div><span><i className="is-demo" /> PagBank</span><strong>{integrations.pagBankConfigured ? "Sandbox configurado" : "Variáveis pendentes"}</strong></div>
              <div><span><i /> Etiquetas</span><strong>{integrations.labelPurchaseEnabled ? "Habilitadas" : "Desativadas por padrão"}</strong></div>
            </div>
            {melhorEnvio.expiresAt && <p className="settings-note">Token atual válido até {new Date(melhorEnvio.expiresAt).toLocaleString("pt-BR")}.</p>}
            {melhorEnvio.unavailable && <p className="settings-note">Não foi possível consultar o estado da conexão. As demais configurações continuam disponíveis.</p>}
            {integrations.melhorEnvioConfigured && <a className="button button--dark button--full" href="/api/integrations/melhor-envio/authorize">{melhorEnvio.connected ? "Reautorizar escopos Sandbox" : "Autorizar Melhor Envio Sandbox"}</a>}
            {!integrations.labelPurchaseEnabled && <p className="settings-note">A compra e impressão dependem de <code>ENABLE_MELHOR_ENVIO_LABEL_PURCHASE=true</code> e validação fiscal.</p>}
            <p className="settings-note">Tokens e segredos ficam exclusivamente no servidor.</p>
          </section>
          <button type="button" className="button button--red button--full" onClick={() => void save()} disabled={saving}><Save size={18} /> {saving ? "Salvando..." : "Salvar configurações"}</button>
        </aside>
      </div>
    </>
  );
}
