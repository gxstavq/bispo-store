import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminOrdersManager } from "@/components/admin-orders-manager";
import { orderRepository } from "@/repositories/order-repository";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await orderRepository.list();
  return (
    <>
      <AdminPageHeader eyebrow="PEDIDOS" title="Fila de atendimento." description="Analise entrega local, frete, pagamento e envio em um só lugar." />
      <AdminOrdersManager initial={orders} />
    </>
  );
}
