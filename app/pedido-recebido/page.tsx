import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { whatsappUrl } from "@/lib/format";
import {
  deliveryChoiceLabels,
  orderStatusLabels,
  paymentStatusLabels,
} from "@/lib/order-status";
import { isValidOrderNumber } from "@/lib/orders/order-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderRepository } from "@/repositories/order-repository";

export const metadata: Metadata = { title: "Pedido recebido", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OrderReceivedPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  if (!isValidOrderNumber(pedido)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/pedido-recebido?pedido=${pedido}`)}`);
  const order = await orderRepository.findById(pedido);
  if (!order) notFound();
  const localReview = order.deliveryChoice === "local_delivery_review";
  const paymentMessages = {
    not_generated: localReview
      ? "Nenhum pagamento foi gerado. A entrega local gratuita ainda depende da confirmação da Bispo Store."
      : "O pagamento ainda não foi liberado para este pedido.",
    awaiting_payment: "O Checkout PagBank foi aberto, mas o pagamento ainda não foi confirmado.",
    in_analysis: "O PagBank está analisando o pagamento. Aguarde a confirmação antes de considerar o pedido pago.",
    paid: "Pagamento confirmado pelo PagBank. O pedido seguirá para preparação.",
    declined: "O pagamento foi recusado. Você poderá solicitar um novo link de pagamento.",
    cancelled: "O pagamento foi cancelado e nenhuma aprovação foi registrada.",
    expired: "O Checkout PagBank expirou. Solicite um novo link para continuar.",
  } satisfies Record<typeof order.paymentStatus, string>;

  return (
    <PublicShell>
      <section className="success-page container">
        <div className="success-icon"><Check /></div>
        <span className="eyebrow eyebrow--red">PEDIDO RECEBIDO</span>
        <h1>Pedido recebido.<br />Acompanhe o status.</h1>
        <p>O pedido <strong>{order.id}</strong> foi localizado. O retorno do PagBank, sozinho, não confirma o pagamento.</p>
        <div className="success-status-grid">
          <div><span>Entrega escolhida</span><strong>{deliveryChoiceLabels[order.deliveryChoice]}</strong></div>
          <div><span>Status atual</span><strong>{orderStatusLabels[order.status]}</strong></div>
          <div><span>Pagamento</span><strong>{paymentStatusLabels[order.paymentStatus]}</strong></div>
        </div>
        <div className="success-card">
          <div>
            <span>Próximo passo</span>
            <strong>{paymentMessages[order.paymentStatus]}</strong>
          </div>
          <a href={whatsappUrl(`Olá! Preciso de ajuda com o pedido ${order.id}.`)} target="_blank" rel="noreferrer" className="button button--dark"><MessageCircle size={18} /> Falar sobre o pedido</a>
        </div>
        <div className="success-actions">
          <Link href={`/acompanhar-pedido?pedido=${order.id}`} className="button button--red">Acompanhar pedido <ArrowRight size={18} /></Link>
          <Link href="/catalogo" className="text-link">Voltar ao catálogo</Link>
        </div>
      </section>
    </PublicShell>
  );
}
