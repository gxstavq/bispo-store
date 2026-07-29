import type { Metadata } from "next";
import { Clock3, Mail, MapPin, MessageCircle } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { whatsappUrl } from "@/lib/format";

export const metadata: Metadata = { title: "Contato", description: "Fale com a equipe da Bispo Store." };

export default function ContactPage() {
  return (
    <PublicShell>
      <section className="contact-page container">
        <div className="contact-intro">
          <span className="eyebrow eyebrow--red">CONTATO</span>
          <h1>Vamos trocar<br />uma ideia?</h1>
          <p>Fale com a Bispo sobre produtos, pedidos ou qualquer dúvida. Nesta fase, todos os canais abaixo são demonstrativos.</p>
          <div className="contact-methods">
            <a href={whatsappUrl("Olá! Preciso de ajuda com a loja.")} target="_blank" rel="noreferrer"><MessageCircle /><div><span>WhatsApp</span><strong>Número configurado por variável de ambiente</strong></div></a>
            <div><Mail /><div><span>E-mail comercial</span><strong>bispostorebr@hotmail.com</strong></div></div>
            <div><MapPin /><div><span>Atendimento</span><strong>Estado de São Paulo</strong></div></div>
            <div><Clock3 /><div><span>Horário sugerido</span><strong>Seg. a sáb. · 9h às 18h</strong></div></div>
          </div>
        </div>
        <div className="contact-form">
          <span className="demo-pill">FORMULÁRIO VISUAL</span>
          <h2>Envie uma mensagem</h2>
          <label>Nome<input placeholder="Nome de demonstração" /></label>
          <label>E-mail<input type="email" placeholder="demo@exemplo.com" /></label>
          <label>Assunto<select defaultValue=""><option value="" disabled>Selecione</option><option>Dúvida sobre produto</option><option>Pedido</option><option>Troca ou devolução</option><option>Outro assunto</option></select></label>
          <label>Mensagem<textarea rows={5} placeholder="Como podemos ajudar?" /></label>
          <button className="button button--dark" type="button">Formulário desativado na demonstração</button>
          <small>Nenhum dado será enviado ou armazenado.</small>
        </div>
      </section>
    </PublicShell>
  );
}
