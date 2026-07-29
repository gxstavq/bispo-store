import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Sobre a loja", description: "Conheça o conceito da Bispo Store, criada por Diogo." };

export default function AboutPage() {
  return (
    <PublicShell>
      <section className="about-hero">
        <div className="container">
          <span className="eyebrow">NOSSA HISTÓRIA · CAPÍTULO 01</span>
          <h1>Da visão do<br />Diogo para a rua.</h1>
          <p>A Bispo Store nasce com uma ideia simples: reunir peças que ajudam cada pessoa a ocupar seu espaço com autenticidade.</p>
        </div>
      </section>
      <section className="about-grid container">
        <div className="about-grid__statement"><span>BS</span><strong>ESTILO NÃO SE IMPÕE.<br />SE RECONHECE.</strong><small>MANIFESTO DEMONSTRATIVO</small></div>
        <div className="about-grid__copy">
          <span className="eyebrow eyebrow--red">O COMEÇO</span>
          <h2>Curadoria próxima, experiência direta.</h2>
          <p>Esta primeira versão apresenta o universo visual e funcional pensado para a loja do Diogo. A proposta combina moda urbana, sneakers e atendimento humano em uma experiência digital simples de usar.</p>
          <p>No lançamento real, cada produto, história e imagem será substituído pela curadoria oficial da Bispo Store.</p>
          <Link href="/catalogo" className="button button--dark">Conhecer a coleção <ArrowRight size={18} /></Link>
        </div>
      </section>
      <section className="values-band"><div className="container"><div><span>01</span><strong>Presença</strong><p>Peças com personalidade e leitura urbana.</p></div><div><span>02</span><strong>Proximidade</strong><p>Atendimento direto antes e depois do pedido.</p></div><div><span>03</span><strong>Evolução</strong><p>Uma estrutura pronta para crescer com a loja.</p></div></div></section>
    </PublicShell>
  );
}
