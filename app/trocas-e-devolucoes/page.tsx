import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Trocas e devoluções", description: "Política preliminar de trocas e devoluções da Bispo Store." };

export default function ExchangesPage() {
  return <LegalPage eyebrow="ATENDIMENTO" title="Trocas e devoluções.">
    <h2>1. Sobre esta versão</h2><p>Este texto é demonstrativo e deverá ser revisado com os dados jurídicos e operacionais reais da Bispo Store antes da publicação.</p>
    <h2>2. Solicitação de troca</h2><p>Como proposta inicial, o cliente poderá solicitar a troca pelo WhatsApp, informando o número do pedido, o produto e o motivo. A equipe orientará sobre disponibilidade e logística.</p>
    <h2>3. Prazo sugerido</h2><p>A política final deverá respeitar a legislação aplicável, incluindo o direito de arrependimento para compras online. Prazos, condições e custos serão definidos na próxima fase.</p>
    <h2>4. Condições do produto</h2><p>Itens deverão ser devolvidos sem sinais de uso, com etiquetas e embalagem original. Situações específicas serão analisadas individualmente.</p>
    <h2>5. Frete</h2><p>O procedimento de coleta ou postagem e a responsabilidade pelo frete serão informados pelo atendimento, conforme o motivo da solicitação.</p>
  </LegalPage>;
}
