"use client";

import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { deliveryChoiceLabels, orderStatusLabels, orderStatuses } from "@/lib/order-status";
import type { StoreOrder } from "@/types/commerce";

export function AdminOrdersManager({ initial }: { initial: StoreOrder[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const visible = useMemo(() => initial.filter((order) => {
    const term = search.replace(/\D/g, "") || search.trim().toLocaleLowerCase("pt-BR");
    const haystack = `${order.id} ${order.customer.fullName} ${order.customer.whatsapp}`.toLocaleLowerCase("pt-BR");
    return (status === "todos" || order.status === status) && (!term || haystack.replace(/\D/g, "").includes(term) || haystack.includes(term));
  }), [initial, search, status]);
  return <>
    <div className="admin-toolbar"><div className="admin-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número, cliente ou telefone..." /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos os status</option>{orderStatuses.map((item) => <option value={item} key={item}>{orderStatusLabels[item]}</option>)}</select></div>
    <div className="admin-list-summary"><span>{visible.length} pedido(s)</span><span>Busca e filtros aplicados imediatamente</span></div>
    <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Entrega</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{visible.map((order) => <tr key={order.id} className="admin-clickable-row"><td><Link href={`/admin/pedidos/${order.id}`}><strong>{order.id}</strong></Link></td><td>{order.createdAt}</td><td>{order.customer.fullName}<small>{order.customer.whatsapp}</small></td><td>{deliveryChoiceLabels[order.deliveryChoice]}</td><td>{formatCurrency(order.subtotal + (order.shippingAmount ?? 0))}</td><td><span className="status-badge">{orderStatusLabels[order.status]}</span></td><td><Link href={`/admin/pedidos/${order.id}`} aria-label={`Abrir ${order.id}`}><ArrowUpRight size={18} /></Link></td></tr>)}</tbody></table></div></section>
  </>;
}
