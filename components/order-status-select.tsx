"use client";

import { Check, CircleX, CreditCard, Save, Truck } from "lucide-react";
import { useState } from "react";
import {
  localReviewLabels,
  orderStatusLabels,
  orderStatuses,
  paymentStatusLabels,
  shippingStatusLabels,
} from "@/lib/order-status";
import { formatCurrency } from "@/lib/format";
import type { OrderStatus, StoreOrder } from "@/types/commerce";

type OrderAction =
  | "approve_local"
  | "reject_local"
  | "choose_conventional"
  | "set_shipping"
  | "enable_payment"
  | "update_status";

export function OrderManagementPanel({
  initial,
  labelPurchaseEnabled,
}: {
  initial: StoreOrder;
  labelPurchaseEnabled: boolean;
}) {
  const [order, setOrder] = useState(initial);
  const [note, setNote] = useState("");
  const [shippingAmount, setShippingAmount] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>(initial.status);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [invoiceKey, setInvoiceKey] = useState("");

  async function apply(action: OrderAction) {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        note,
        shippingAmount: shippingAmount ? Number(shippingAmount) : undefined,
        status: selectedStatus,
      }),
    });
    const result = await response.json() as StoreOrder & { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(result.error ?? "Não foi possível registrar a alteração.");
      return;
    }
    setOrder(result);
    setSelectedStatus(result.status);
    setMessage(action === "enable_payment" ? "Checkout PagBank Sandbox criado." : "Alteração registrada no histórico.");
    setNote("");
  }

  async function labelAction(action: "purchase" | "print" | "track") {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/admin/orders/${order.id}/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, invoiceKey }),
    });
    const result = await response.json() as { error?: string; printUrl?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(result.error ?? "Não foi possível processar a etiqueta.");
      return;
    }
    setMessage(action === "purchase" ? "Etiqueta comprada e geração solicitada no Sandbox." : action === "print" ? "Link de impressão atualizado." : "Rastreamento atualizado.");
    if (result.printUrl) window.open(result.printUrl, "_blank", "noopener,noreferrer");
  }

  const pendingReview = order.localDeliveryReview.status === "pending";
  const rejected = order.localDeliveryReview.status === "rejected";
  const approved = order.localDeliveryReview.status === "approved";
  const awaitingShipping = order.status === "awaiting_shipping_selection";

  return (
    <div className="order-management">
      <div className="order-state-grid">
        <div><span>Análise local</span><strong>{localReviewLabels[order.localDeliveryReview.status]}</strong></div>
        <div><span>Pagamento</span><strong>{paymentStatusLabels[order.paymentStatus]}</strong></div>
        <div><span>Envio</span><strong>{shippingStatusLabels[order.shippingStatus]}</strong></div>
        <div><span>Frete</span><strong>{order.shippingAmount === null ? "Não definido" : formatCurrency(order.shippingAmount)}</strong></div>
      </div>
      <div className="admin-form-grid decision-fields">
        <label>Valor do frete convencional<input type="number" min="0" step="0.01" value={shippingAmount} onChange={(event) => setShippingAmount(event.target.value)} placeholder="0,00" /></label>
        <label className="span-2">Observação obrigatória<textarea required rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Registre o motivo. O responsável será a conta autenticada." /></label>
      </div>
      <div className="decision-actions">
        {pendingReview && <>
          <small>Confirme a gratuidade somente após verificar manualmente que o endereço está dentro do raio de 5 km.</small>
          <button className="button button--dark" disabled={saving} onClick={() => void apply("approve_local")}><Check size={17} /> Confirmar entrega grátis</button>
          <button className="button button--outline-danger" disabled={saving} onClick={() => void apply("reject_local")}><CircleX size={17} /> Recusar entrega grátis</button>
        </>}
        {rejected && <button className="button button--dark" disabled={saving} onClick={() => void apply("choose_conventional")}><Truck size={17} /> Escolher frete convencional</button>}
        {(awaitingShipping || order.deliveryChoice === "shipping_quote") && order.shippingAmount === null && <button className="button button--red" disabled={saving} onClick={() => void apply("set_shipping")}><Truck size={17} /> Registrar frete selecionado</button>}
        {approved && order.paymentStatus === "not_generated" && <button className="button button--red" disabled={saving} onClick={() => void apply("enable_payment")}><CreditCard size={17} /> Gerar Checkout PagBank Sandbox</button>}
      </div>
      <div className="manual-status-control">
        <label>Status operacional<select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as OrderStatus)}>{selectedStatus === "paid" && <option value="paid" disabled>Pago — confirmado pelo PagBank</option>}{orderStatuses.filter((status) => status !== "paid").map((status) => <option value={status} key={status}>{orderStatusLabels[status]}</option>)}</select></label>
        <button className="button button--dark" disabled={saving} onClick={() => void apply("update_status")}><Save size={17} /> Registrar status</button>
      </div>
      {order.payment?.paymentUrl && <div className="admin-feedback">
        <strong>Checkout PagBank Sandbox</strong><br />
        ID: {order.payment.checkoutId}<br />
        <a href={order.payment.paymentUrl} target="_blank" rel="noreferrer">Abrir link</a>
        {" · "}<a href={`https://wa.me/${order.customer.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Segue o link de pagamento Sandbox do pedido ${order.id}: ${order.payment.paymentUrl}`)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
      </div>}
      {labelPurchaseEnabled ? <div className="admin-form-grid decision-fields">
        <label className="span-2">Chave da nota fiscal (44 dígitos)<input value={invoiceKey} onChange={(event) => setInvoiceKey(event.target.value)} /></label>
        <div className="decision-actions span-2">
          {!order.shipmentLabel?.providerOrderId && <button className="button button--red" disabled={saving || order.status !== "paid"} onClick={() => void labelAction("purchase")}>Comprar e gerar etiqueta Sandbox</button>}
          {order.shipmentLabel?.providerOrderId && <button className="button button--dark" disabled={saving} onClick={() => void labelAction("print")}>Obter link de impressão</button>}
          {order.shipmentLabel?.providerOrderId && <button className="button button--dark" disabled={saving} onClick={() => void labelAction("track")}>Atualizar rastreamento</button>}
        </div>
      </div> : <small>Compra e impressão ocultas: dependem de <code>ENABLE_MELHOR_ENVIO_LABEL_PURCHASE=true</code> e configuração fiscal.</small>}
      <small>Ambiente Sandbox. O status “pago” só é aplicado após consulta confirmada ao PagBank.</small>
      {message && <div className="admin-feedback" role="status">{message}</div>}
    </div>
  );
}
