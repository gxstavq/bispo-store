import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Termos de uso", description: "Termos de uso preliminares da Bispo Store." };

export default function TermsPage() {
  return <LegalPage eyebrow="REGRAS DA CASA" title="Termos de uso.">
    <h2>1. Ambiente demonstrativo</h2><p>Os produtos, valores, estoques, clientes e pedidos exibidos nesta versão são fictícios. Nenhuma compra real ou cobrança será realizada.</p>
    <h2>2. Uso da plataforma</h2><p>Ao acessar o site futuro, o usuário se comprometerá a fornecer informações corretas e utilizar os recursos de forma legítima.</p>
    <h2>3. Pedidos e pagamento</h2><p>As condições comerciais, formas de pagamento e confirmação de pedidos serão apresentadas na versão oficial. Não há formulário de cartão nesta demonstração.</p>
    <h2>4. Propriedade intelectual</h2><p>A marca Bispo Store, sua identidade e conteúdos próprios pertencem aos respectivos titulares. Imagens conceituais desta fase são apenas placeholders.</p>
    <h2>5. Alterações</h2><p>Os termos finais poderão ser atualizados para refletir mudanças legais, comerciais ou tecnológicas.</p>
  </LegalPage>;
}
