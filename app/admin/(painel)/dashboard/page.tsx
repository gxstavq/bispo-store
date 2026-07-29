import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Banknote, Boxes, Clock3,
  PackageCheck, ShoppingBag, TrendingUp,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { formatCurrency } from "@/lib/format";
import { orderStatusLabels } from "@/lib/order-status";
import { orderRepository } from "@/repositories/order-repository";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export const dynamic = "force-dynamic";

const dayKey = (value: Date | string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date(value));

export default async function DashboardPage() {
  const [products, orders] = await Promise.all([
    fetchProducts({ includeInactive: true }),
    orderRepository.list(),
  ]);
  const now = new Date();
  const today = dayKey(now);
  const todayOrders = orders.filter((order) => order.createdAtIso && dayKey(order.createdAtIso) === today);
  const paidToday = todayOrders.filter((order) => order.paymentStatus === "paid");
  const salesToday = paidToday.reduce((sum, order) => sum + order.subtotal + (order.shippingAmount ?? 0), 0);
  const averageTicket = paidToday.length ? salesToday / paidToday.length : 0;
  const lowStock = products.filter((product) => product.active && product.stock <= 7);
  const waitingAction = orders.filter((order) =>
    ["awaiting_local_delivery_review", "awaiting_shipping_selection", "local_delivery_rejected"].includes(order.status)
  ).length;
  const metrics = [
    { label: "Vendas do dia", value: formatCurrency(salesToday), trend: `${paidToday.length} pagamentos confirmados`, icon: Banknote, accent: true },
    { label: "Pedidos do dia", value: String(todayOrders.length).padStart(2, "0"), trend: `${waitingAction} aguardam ação`, icon: ShoppingBag },
    { label: "Ticket médio", value: formatCurrency(averageTicket), trend: "pedidos pagos hoje", icon: TrendingUp },
    { label: "Baixo estoque", value: String(lowStock.length).padStart(2, "0"), trend: "produtos ativos até 7 un.", icon: Boxes },
  ];
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - offset));
    const key = dayKey(date);
    return {
      key,
      label: new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" })
        .format(date).replace(".", "").toUpperCase(),
      count: orders.filter((order) => order.createdAtIso && dayKey(order.createdAtIso) === key).length,
    };
  });
  const maxDaily = Math.max(1, ...week.map((day) => day.count));
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo",
  }).format(now).toUpperCase().replace(".", "");

  return (
    <>
      <AdminPageHeader
        eyebrow="VISÃO GERAL"
        title="A loja em um olhar."
        description="Indicadores calculados a partir dos dados protegidos no Supabase."
        action={<span className="admin-date">{dateLabel}</span>}
      />
      <div className="metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className={metric.accent ? "metric-card metric-card--accent" : "metric-card"}>
              <div><span>{metric.label}</span><Icon size={20} /></div>
              <strong>{metric.value}</strong><small>{metric.trend}</small>
            </article>
          );
        })}
      </div>
      <div className="admin-grid admin-grid--wide">
        <section className="admin-panel">
          <div className="admin-panel__header"><div><span>FLUXO DE PEDIDOS</span><h2>Status da operação</h2></div></div>
          <div className="order-flow">
            <div><i className="flow-dot flow-dot--amber"><Clock3 /></i><span>Análise/seleção de frete</span><strong>{waitingAction}</strong></div>
            <div><i className="flow-dot flow-dot--red"><PackageCheck /></i><span>Em preparação</span><strong>{orders.filter((order) => order.status === "preparing").length}</strong></div>
            <div><i className="flow-dot flow-dot--green"><PackageCheck /></i><span>Entregues</span><strong>{orders.filter((order) => order.status === "delivered").length}</strong></div>
          </div>
          <div className="mock-chart">
            {week.map((day) => (
              <span key={day.key} style={{ height: `${Math.max(5, (day.count / maxDaily) * 100)}%` }} title={`${day.count} pedidos`}>
                <i>{day.label}</i>
              </span>
            ))}
          </div>
        </section>
        <section className="admin-panel">
          <div className="admin-panel__header"><div><span>ATENÇÃO</span><h2>Estoque baixo</h2></div><Link href="/admin/estoque">Ver estoque <ArrowUpRight size={16} /></Link></div>
          <div className="low-stock-list">
            {lowStock.slice(0, 5).map((product) => (
              <div key={product.id}><span><AlertTriangle size={16} /></span><div><strong>{product.name}</strong><small>{product.code}</small></div><b>{product.stock} un.</b></div>
            ))}
          </div>
        </section>
      </div>
      <section className="admin-panel">
        <div className="admin-panel__header"><div><span>ATIVIDADE</span><h2>Pedidos recentes</h2></div><Link href="/admin/pedidos">Ver todos <ArrowUpRight size={16} /></Link></div>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {orders.slice(0, 10).map((order) => (
              <tr key={order.id}>
                <td><strong>{order.id}</strong></td><td>{order.customer.fullName}</td><td>{order.createdAt}</td>
                <td>{formatCurrency(order.subtotal + (order.shippingAmount ?? 0))}</td>
                <td><span className="status-badge">{orderStatusLabels[order.status]}</span></td>
                <td><Link href={`/admin/pedidos/${order.id}`}>Abrir</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
