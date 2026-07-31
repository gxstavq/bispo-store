import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Headphones, MapPin, ShieldCheck } from "lucide-react";
import { ProductGrid } from "@/components/product-grid";
import { ProductVisual } from "@/components/product-visual";
import { PublicShell } from "@/components/public-shell";
import { SectionTitle } from "@/components/section-title";
import { whatsappUrl } from "@/lib/format";
import { fetchProducts } from "@/repositories/supabase-product-repository";

export const metadata: Metadata = {
  title: "Moda urbana com presença",
  description: "Descubra a coleção de tênis, calças e conjuntos da Bispo Store.",
};
export const revalidate = 60;

export default async function Home() {
  const [sneakers, pants, sets, launches, offers, bestSellers] = await Promise.all([
    fetchProducts({ category: "tenis", limit: 4 }),
    fetchProducts({ category: "calcas", limit: 4 }),
    fetchProducts({ category: "conjuntos", limit: 4 }),
    fetchProducts({ isNew: true, limit: 4 }),
    fetchProducts({ onSale: true, limit: 4 }),
    fetchProducts({ featured: true, limit: 4 }),
  ]);
  const heroProduct = launches[0] ?? sneakers[0] ?? pants[0] ?? sets[0];

  return (
    <PublicShell>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="hero-kicker">BISPO DROP 001 · MODA URBANA</span>
            <h1>Vista sua<br /><em>presença.</em></h1>
            <p>Tênis, calças e conjuntos para quem não passa despercebido. Uma curadoria urbana com atitude, conforto e identidade própria.</p>
            <div className="hero-actions">
              <Link href="/catalogo" className="button button--light">Explorar coleção <ArrowRight size={19} /></Link>
              <Link href="/categoria/tenis" className="button button--ghost">Ver sneakers</Link>
            </div>
            <div className="hero-delivery-message">ENTREGAS PARA TODO O BRASIL</div>
          </div>
          <div className="hero-art">
            <div className="hero-art__type">MOVE<br />WITH<br />PURPOSE</div>
            {heroProduct
              ? <ProductVisual product={heroProduct} label={heroProduct.coverImage ?? "DROP 001"} priority showStatus={false} />
              : <div className="empty-state"><strong>Curadoria Bispo Store.</strong><p>Tênis, calças e conjuntos com identidade urbana.</p></div>}
            <span className="hero-art__note">CURADORIA BISPO STORE</span>
          </div>
        </div>
      </section>

      <section className="category-strip">
        <div className="container category-strip__grid">
          <Link href="/categoria/tenis" className="category-card category-card--red">
            <span>01</span><div><small>PASSO FIRME</small><strong>SNEAKERS</strong></div><ArrowRight />
          </Link>
          <Link href="/categoria/calcas" className="category-card category-card--light">
            <span>02</span><div><small>BASE DO VISUAL</small><strong>CALÇAS</strong></div><ArrowRight />
          </Link>
          <Link href="/categoria/conjuntos" className="category-card category-card--dark">
            <span>03</span><div><small>LOOK COMPLETO</small><strong>CONJUNTOS</strong></div><ArrowRight />
          </Link>
        </div>
      </section>

      <section className="section container">
        <SectionTitle eyebrow="Acabou de chegar" title="Lançamentos" href="/catalogo?filtro=lancamentos" />
        <ProductGrid products={launches} showInternalLabels={false} />
      </section>

      <section className="manifesto-band">
        <div className="container">
          <span>ORIGINAL NO JEITO</span><i />
          <span>FORTE NA PRESENÇA</span><i />
          <span>FEITO PARA A RUA</span>
        </div>
      </section>

      <section className="section container">
        <SectionTitle eyebrow="Da sola ao topo" title="Tênis em destaque" href="/categoria/tenis" />
        <ProductGrid products={sneakers} showInternalLabels={false} />
      </section>

      <section className="editorial container">
        <div className="editorial__visual">
          <span className="editorial__number">B/01</span>
          <div className="editorial__figure">
            <span />
            <strong>BISPO<br />STREET<br />UNIFORM</strong>
          </div>
          <small>EDITORIAL BISPO STORE</small>
        </div>
        <div className="editorial__copy">
          <span className="eyebrow eyebrow--red">Além do básico</span>
          <h2>Peças para criar seu próprio uniforme.</h2>
          <p>Modelagens confortáveis, paleta versátil e detalhes que seguram o look. Uma curadoria urbana feita para criar combinações com presença.</p>
          <Link href="/categoria/conjuntos" className="button button--dark">Ver conjuntos <ArrowRight size={18} /></Link>
        </div>
      </section>

      <section className="section section--muted">
        <div className="container">
          <SectionTitle eyebrow="Base do guarda-roupa" title="Calças" href="/categoria/calcas" />
          {pants.length ? <ProductGrid products={pants} showInternalLabels={false} /> : <div className="empty-state"><strong>Calças Bispo Store.</strong><p>Modelagens urbanas para completar o visual.</p></div>}
        </div>
      </section>

      <section className="section container">
        <SectionTitle eyebrow="Visual coordenado" title="Conjuntos" href="/categoria/conjuntos" />
        {sets.length ? <ProductGrid products={sets} showInternalLabels={false} /> : <div className="empty-state"><strong>Conjuntos Bispo Store.</strong><p>Combinações coordenadas com identidade urbana.</p></div>}
      </section>

      <section className="section container">
        <SectionTitle eyebrow="Seleção especial" title="Ofertas da semana" href="/catalogo?filtro=ofertas" />
        <ProductGrid products={offers} showInternalLabels={false} />
      </section>

      <section className="section container">
        <SectionTitle eyebrow="Escolhas da comunidade" title="Mais vendidos" href="/catalogo" />
        <ProductGrid products={bestSellers} showInternalLabels={false} />
      </section>

      <section className="benefits">
        <div className="container benefits-grid">
          <div><MapPin /><strong>Frete para todo o Brasil</strong><p>Cotação pelo CEP com opções de transportadoras.</p></div>
          <div><ShieldCheck /><strong>Compra acompanhada</strong><p>Comunicação clara pelo WhatsApp em todas as etapas.</p></div>
          <div><BadgeCheck /><strong>Curadoria Bispo</strong><p>Seleção visual voltada para sneakers e moda urbana.</p></div>
          <div><Headphones /><strong>Atendimento direto</strong><p>Converse com a loja antes e depois de finalizar o pedido.</p></div>
        </div>
      </section>

      <section className="whatsapp-cta">
        <div className="container">
          <div>
            <span>PRECISA DE AJUDA?</span>
            <h2>Fala com a gente.<br />Sem enrolação.</h2>
          </div>
          <a href={whatsappUrl("Olá! Preciso de ajuda com a loja.")} target="_blank" rel="noreferrer" className="button button--light">Chamar no WhatsApp <ArrowRight size={19} /></a>
        </div>
      </section>
    </PublicShell>
  );
}
