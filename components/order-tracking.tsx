"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Check, PackageCheck, Search, Truck } from "lucide-react";
import { orderStatusLabels } from "@/lib/order-status";
import type { StoreOrder } from "@/types/commerce";

export function OrderTracking() {
  const searchParams = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(() => searchParams.get("pedido") ?? "");
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setOrder(null);
    setLoginRequired(false);
    const normalized = orderNumber.trim().toUpperCase();
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(normalized)}`);
      const result = await response.json() as StoreOrder & { error?: string; loginRequired?: boolean };
      if (response.status === 401) {
        setLoginRequired(true);
        setMessage("Entre com o e-mail usado no pedido para consultá-lo.");
        return;
      }
      if (!response.ok) {
        setMessage(result.error ?? "Pedido não encontrado para esta conta.");
        return;
      }
      setOrder(result);
    } catch {
      setMessage("Não foi possível consultar o pedido agora.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tracking-box">
      <form onSubmit={submit}>
        <label>Número do pedido</label>
        <div>
          <input
            required
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder="Ex.: BSP-1048"
          />
          <button className="button button--red" disabled={loading}>
            <Search size={18} /> {loading ? "Consultando..." : "Consultar"}
          </button>
        </div>
        <small>A consulta é protegida: cada cliente visualiza somente os próprios pedidos.</small>
      </form>

      {message && (
        <div className="admin-feedback" role="status">
          {message} {loginRequired && <Link href={`/entrar?next=${encodeURIComponent("/acompanhar-pedido")}`}>Entrar com e-mail</Link>}
        </div>
      )}

      {order && (
        <div className="tracking-result">
          <div className="tracking-result__header">
            <div><span>Pedido</span><h2>{order.id}</h2></div>
            <span className="status-badge">{orderStatusLabels[order.status]}</span>
          </div>
          <div className="tracking-steps">
            <div className="is-done"><i><Check /></i><strong>Pedido recebido</strong><span>{order.createdAt}</span></div>
            <div className={order.shippingStatus === "awaiting_review" || order.shippingStatus === "awaiting_selection" ? "is-current" : "is-done"}>
              <i><Truck /></i><strong>Entrega</strong><span>{order.shippingStatus.replaceAll("_", " ")}</span>
            </div>
            <div className={order.paymentStatus === "paid" ? "is-done" : "is-current"}>
              <i><Check /></i><strong>Pagamento</strong><span>{order.paymentStatus.replaceAll("_", " ")}</span>
            </div>
            <div className={order.status === "delivered" ? "is-done" : ""}>
              <i><PackageCheck /></i><strong>Conclusão</strong><span>{orderStatusLabels[order.status]}</span>
            </div>
          </div>
          <p className="tracking-note">As informações são carregadas do Supabase e protegidas pelas políticas de acesso do pedido.</p>
        </div>
      )}
    </div>
  );
}
