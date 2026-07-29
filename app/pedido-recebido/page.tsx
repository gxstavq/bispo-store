import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { whatsappUrl } from "@/lib/format";
import { deliveryChoiceLabels, orderStatusLabels } from "@/lib/order-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderRepository } from "@/repositories/order-repository";

export const metadata: Metadata = { title: "Pedido recebido", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OrderReceivedPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  if (!pedido) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/pedido-recebido?pedido=${pedido}`)}`);
  const order = await orderRepository.findById(pedido);
  if (!order) notFound();
  const localReview = order.deliveryChoice === "local_delivery_review";

  return (
    <PublicShell>
      <section className="success-page container">
        <div className="success-icon"><Check /></div>
        <span className="eyebrow eyebrow--red">PEDIDO RECEBIDO</span>
        <h1>Recebemos.<br />Agora analisamos.</h1>
        <p>O pedido <strong>{order.id}</strong> foi criado sem gerar pagamento ou cobrança de frete.</p>
        <div className="success-status-grid">
          <div><span>Entrega escolhida</span><strong>{deliveryChoiceLabels[order.deliveryChoice]}</strong></div>
          <div><span>Status atual</span><strong>{orderStatusLabels[order.status]}</strong></div>
        </div>
        <div className="success-card">
          <div>
            <span>Próximo passo</span>
            <strong>{localReview
              ? "A Bispo Store verificará se o endereço atende à entrega local grátis em até 5 km. A gratuidade depende de confirmação."
              : "A Bispo Store selecionará manualmente uma opção de frete convencional antes de liberar o pagamento."}</strong>
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
