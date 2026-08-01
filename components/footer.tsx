import Image from "next/image";
import Link from "next/link";
import { Instagram, MapPin, MessageCircle } from "lucide-react";
import { whatsappUrl } from "@/lib/format";
import type { ProductCategoryRecord } from "@/types/commerce";

export function Footer({ categories = [] }: { categories?: ProductCategoryRecord[] }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Image src="/logo-bispo-store.png" width={120} height={120} alt="Bispo Store" />
          <p>Moda urbana e sneakers escolhidos para quem transforma presença em assinatura.</p>
          <span className="demo-pill">BISPO STORE</span>
        </div>
        <div>
          <h3>Comprar</h3>
          <Link href="/catalogo">Todos os produtos</Link>
          {categories.map((category) => <Link href={`/categoria/${category.slug}`} key={category.id}>{category.name}</Link>)}
          <Link href="/carrinho">Carrinho</Link>
        </div>
        <div>
          <h3>Ajuda</h3>
          <Link href="/acompanhar-pedido">Acompanhar pedido</Link>
          <Link href="/trocas-e-devolucoes">Trocas e devoluções</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/termos">Termos de uso</Link>
        </div>
        <div>
          <h3>Fale com a Bispo</h3>
          <a href={whatsappUrl("Olá! Preciso de ajuda com a loja.")} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
          <a href="https://www.instagram.com/bispostorebr_" target="_blank" rel="noopener noreferrer" aria-label="Abrir Instagram oficial da Bispo Store em nova aba"><Instagram size={16} /> Instagram</a>
          <span><MapPin size={16} /> Avenida São Miguel, 5046</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 Bispo Store. Todos os direitos reservados.</span>
        <span>Moda urbana, sneakers e atitude em cada escolha.</span>
      </div>
    </footer>
  );
}
