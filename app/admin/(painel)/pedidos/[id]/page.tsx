import Link from "next/link";
import { ArrowLeft, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { OrderManagementPanel } from "@/components/order-status-select";
import { formatCurrency, whatsappUrl } from "@/lib/format";
import {
  deliveryChoiceLabels,
  localReviewLabels,
  orderStatusLabels,
  paymentStatusLabels,
  shippingStatusLabels,
} from "@/lib/order-status";
import { orderRepository } from "@/repositories/order-repository";
import { safeIntegrationConfiguration } from "@/lib/integrations/config";

export const dynamic = "force-dynamic";

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await orderRepository.findById(id);
  if (!order) notFound();
  const total = order.subtotal + (order.shippingAmount ?? 0);
  return (
    <>
      <Link href="/admin/pedidos" className="admin-back"><ArrowLeft size={17} /> Voltar aos pedidos</Link>
      <AdminPageHeader
        eyebrow="DETALHES DO PEDIDO"
        title={order.id}
        description={`Criado em ${order.createdAt} · ${orderStatusLabels[order.status]}`}
        action={<a href={whatsappUrl(`Olá, ${order.customer.fullName}! Estou falando sobre seu pedido ${order.id} na Bispo Store.`)} target="_blank" rel="noreferrer" className="button button--dark"><MessageCircle size={18} /> Falar com o cliente no WhatsApp</a>}
      />
      <div className="admin-detail-grid">
        <div>
          <section className="admin-panel order-products">
            <div className="admin-panel__header"><div><span>ITENS</span><h2>Produtos do pedido</h2></div></div>
            {order.items.map((item) => {
              const name = item.productName ?? "Produto arquivado";
              const code = item.productCode ?? "SEM-SKU";
              const unitPrice = item.unitPrice ?? 0;
              return <div className="order-product-row" key={`${item.productId}-${item.size}-${item.color}`}><div className="mini-product">BS</div><div><strong>{name}</strong><span>{code} · Tam. {item.size} · {item.color}</span></div><b>{item.quantity}×</b><strong>{formatCurrency(unitPrice * item.quantity)}</strong></div>;
            })}
            <div className="order-totals">
              <div><span>Valor dos produtos</span><strong>{formatCurrency(order.subtotal)}</strong></div>
              <div><span>Valor do frete</span><strong>{order.shippingAmount === null ? "Ainda não definido" : formatCurrency(order.shippingAmount)}</strong></div>
              <div><span>Total atual</span><strong>{formatCurrency(total)}</strong></div>
            </div>
          </section>
          <section className="admin-panel">
            <div className="admin-panel__header"><div><span>ENTREGA & PAGAMENTO</span><h2>Resumo operacional</h2></div></div>
            <div className="order-operation-summary">
              <div><span>Opção escolhida</span><strong>{deliveryChoiceLabels[order.deliveryChoice]}</strong></div>
              <div><span>Análise local</span><strong>{localReviewLabels[order.localDeliveryReview.status]}</strong></div>
              <div><span>Pagamento</span><strong>{paymentStatusLabels[order.paymentStatus]}</strong></div>
              <div><span>Envio</span><strong>{shippingStatusLabels[order.shippingStatus]}</strong></div>
              <div><span>ID do Checkout</span><strong>{order.payment?.checkoutId ?? "Não gerado"}</strong></div>
              <div><span>Forma</span><strong>{order.payment?.method ?? "Aguardando escolha"}</strong></div>
              <div><span>Status do provedor</span><strong>{order.payment?.providerStatus ?? "Sem retorno"}</strong></div>
              <div><span>Total</span><strong>{formatCurrency(total)}</strong></div>
            </div>
            {order.payment?.events?.length ? <div className="order-history">
              {order.payment.events.map((event) => <div key={event.id}><i /><div><strong>{event.type?.includes("reconciliation") ? "Reconciliação direta verificada" : event.verified ? "Notificação verificada" : "Notificação não confirmada"}{event.status ? ` · ${event.status}` : ""}</strong><span>{event.date}</span>{event.error && <p>{event.error}</p>}</div></div>)}
            </div> : null}
          </section>
          <section className="admin-panel">
            <div className="admin-panel__header"><div><span>HISTÓRICO</span><h2>Linha do tempo</h2></div></div>
            <div className="order-history">{order.history.map((item, index) => <div key={`${item.date}-${index}`}><i /><div><strong>{item.label}</strong><span>{item.date}{item.actor ? ` · por ${item.actor}` : ""}</span>{item.note && <p>{item.note}</p>}</div></div>)}</div>
          </section>
        </div>
        <aside>
          <section className="admin-panel customer-card">
            <div className="admin-panel__header"><div><span>CLIENTE</span><h2>{order.customer.fullName}</h2></div></div>
            <a href={whatsappUrl(`Olá, ${order.customer.fullName}!`)} target="_blank" rel="noreferrer"><Phone size={17} /> {order.customer.whatsapp}</a>
            <span><Mail size={17} /> {order.customer.email}</span>
            <div className="address-box"><MapPin size={18} /><p>{order.customer.street}, {order.customer.number}{order.customer.complement ? ` · ${order.customer.complement}` : ""}<br />{order.customer.district} · {order.customer.city}/{order.customer.state}<br />CEP {order.customer.cep}{order.customer.reference ? <><br />Ref.: {order.customer.reference}</> : null}</p></div>
            {order.customer.notes && <div className="admin-note"><span>Observações do cliente</span><p>{order.customer.notes}</p></div>}
          </section>
          <section className="admin-panel">
            <div className="admin-panel__header"><div><span>DECISÃO</span><h2>Gerenciar pedido</h2></div></div>
            <OrderManagementPanel
              initial={order}
              labelPurchaseEnabled={safeIntegrationConfiguration().labelPurchaseEnabled}
            />
          </section>
        </aside>
      </div>
    </>
  );
}
