import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";
import { safeIntegrationConfiguration } from "@/lib/integrations/config";
import { checkoutCompletionMode } from "@/lib/checkout-mode";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  const pagBankEnvironment = safeIntegrationConfiguration().pagBankEnvironment;
  const completionMode = checkoutCompletionMode();
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple"><div className="container"><span>FINALIZAÇÃO SEGURA</span><h1>Checkout.</h1><p>Confira seus dados, a entrega e o total antes de finalizar o pedido.</p></div></section>
      <section className="section container"><CheckoutForm completionMode={completionMode} pagBankEnvironment={pagBankEnvironment} /></section>
    </PublicShell>
  );
}
