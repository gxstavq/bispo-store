import { Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin-page-header";
import { formatCurrency } from "@/lib/format";
import { orderRepository } from "@/repositories/order-repository";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const orders = await orderRepository.list();
  const customers = [...orders.reduce((grouped, order) => {
    const key = order.customer.email.toLowerCase();
    const current = grouped.get(key) ?? {
      customer: order.customer,
      orders: 0,
      total: 0,
      lastOrder: order.createdAt,
      lastOrderIso: order.createdAtIso ?? "",
    };
    current.orders += 1;
    current.total += order.subtotal + (order.shippingAmount ?? 0);
    if ((order.createdAtIso ?? "") > current.lastOrderIso) {
      current.lastOrder = order.createdAt;
      current.lastOrderIso = order.createdAtIso ?? "";
    }
    grouped.set(key, current);
    return grouped;
  }, new Map<string, {
    customer: (typeof orders)[number]["customer"];
    orders: number;
    total: number;
    lastOrder: string;
    lastOrderIso: string;
  }>()).values()];

  return (
    <>
      <AdminPageHeader eyebrow="CLIENTES" title="Relacionamentos." description="Clientes reais derivados dos pedidos protegidos no Supabase." />
      <div className="admin-toolbar">
        <div className="admin-search"><Search size={17} /><input placeholder="Buscar cliente..." /></div>
        <span className="demo-pill">ACESSO ADMINISTRATIVO</span>
      </div>
      <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Cliente</th><th>Contato</th><th>Cidade</th><th>Pedidos</th><th>Total atual</th><th>Último pedido</th></tr></thead>
        <tbody>
          {customers.map(({ customer, orders: count, total, lastOrder }) => (
            <tr key={customer.email}>
              <td><strong>{customer.fullName}</strong></td>
              <td>{customer.whatsapp}<small>{customer.email}</small></td>
              <td>{customer.city}/SP</td>
              <td>{count}</td>
              <td>{formatCurrency(total)}</td>
              <td>{lastOrder}</td>
            </tr>
          ))}
        </tbody>
      </table></div></section>
    </>
  );
}
