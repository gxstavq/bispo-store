import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Política de privacidade", description: "Política preliminar de privacidade da Bispo Store." };

export default function PrivacyPage() {
  return <LegalPage eyebrow="SEUS DADOS" title="Política de privacidade.">
    <h2>1. Escopo</h2><p>Esta é uma versão de demonstração. Não utilize dados pessoais reais durante a apresentação e nenhum dado financeiro é solicitado ou armazenado.</p>
    <h2>2. Dados previstos</h2><p>Na versão futura, poderão ser tratados dados de identificação, contato, endereço e informações necessárias para processar e entregar pedidos.</p>
    <h2>3. Finalidades</h2><p>Os dados serão utilizados para atendimento, gestão de pedidos, entrega, comunicação e cumprimento de obrigações legais.</p>
    <h2>4. Compartilhamento</h2><p>Eventuais compartilhamentos serão limitados a provedores necessários à operação, como pagamento, hospedagem e logística, sempre conforme a legislação.</p>
    <h2>5. Direitos</h2><p>O titular poderá solicitar acesso, correção ou exclusão de seus dados pelos canais oficiais que serão definidos antes do lançamento.</p>
  </LegalPage>;
}
