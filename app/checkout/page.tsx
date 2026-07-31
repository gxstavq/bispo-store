import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";
import { safeIntegrationConfiguration } from "@/lib/integrations/config";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  const pagBankEnvironment = safeIntegrationConfiguration().pagBankEnvironment;
  return (
    <PublicShell>
      <section className="page-hero page-hero--simple"><div className="container"><span>FINALIZAÇÃO SEGURA</span><h1>Checkout.</h1><p>Confira seus dados, a entrega e o total antes de seguir para o PagBank.</p></div></section>
      <section className="section container"><CheckoutForm pagBankEnvironment={pagBankEnvironment} /></section>
    </PublicShell>
  );
}
