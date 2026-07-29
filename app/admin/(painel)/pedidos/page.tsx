import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { formatCurrency } from "@/lib/format";
import { deliveryChoiceLabels, orderStatusLabels, orderStatuses } from "@/lib/order-status";
import { orderRepository } from "@/repositories/order-repository";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await orderRepository.list();
  return (
    <>
      <AdminPageHeader eyebrow="PEDIDOS" title="Fila de atendimento." description="Analise entrega local, frete, pagamento e envio em um só lugar." />
      <div className="admin-toolbar"><div className="admin-search"><Search size={17} /><input placeholder="Buscar pedido ou cliente..." /></div><select defaultValue="todos"><option value="todos">Todos os status</option>{orderStatuses.map((status) => <option value={status} key={status}>{orderStatusLabels[status]}</option>)}</select></div>
      <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Total atual</th><th>Frete</th><th>Status</th><th /></tr></thead><tbody>
        {orders.map((order) => <tr key={order.id}><td><strong>{order.id}</strong><small>{order.createdAt}</small></td><td>{order.customer.fullName}<small>{order.customer.whatsapp}</small></td><td>{deliveryChoiceLabels[order.deliveryChoice]}</td><td>{formatCurrency(order.subtotal + (order.shippingAmount ?? 0))}</td><td>{order.shippingAmount === null ? "Pendente" : formatCurrency(order.shippingAmount)}</td><td><span className="status-badge">{orderStatusLabels[order.status]}</span></td><td><Link href={`/admin/pedidos/${order.id}`} aria-label={`Abrir ${order.id}`}><ArrowUpRight size={18} /></Link></td></tr>)}
      </tbody></table></div></section>
    </>
  );
}
