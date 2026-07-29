import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderTracking } from "@/components/order-tracking";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Acompanhar pedido", description: "Consulte com segurança o status do seu pedido Bispo Store.", robots: { index: false } };

export default function TrackOrderPage() {
  return (
    <PublicShell>
      <section className="page-hero page-hero--track"><div className="container"><span>DO DROP ATÉ VOCÊ</span><h1>Acompanhe<br />seu pedido.</h1><p>Consulte cada etapa usando o número informado na confirmação.</p></div></section>
      <section className="section container"><Suspense fallback={<div className="tracking-box">Carregando consulta...</div>}><OrderTracking /></Suspense></section>
    </PublicShell>
  );
}
