import type { Metadata } from "next";
import { CustomerLoginForm } from "@/components/customer-login-form";
import { PublicShell } from "@/components/public-shell";
import { safeInternalPath } from "@/lib/security/request";

export const metadata: Metadata = { title: "Acessar minha conta", robots: { index: false } };

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; envio?: string }>;
}) {
  const { next = "/checkout", envio } = await searchParams;
  const safeNext = safeInternalPath(next, "/checkout");
  return (
    <PublicShell>
      <section className="auth-page container">
        <span className="eyebrow eyebrow--red">ACESSO DO CLIENTE</span>
        <h1>Seus pedidos.<br />Somente seus.</h1>
        <p>Receba um link de acesso por e-mail. A sessão protege seus endereços e pedidos com Supabase Auth e RLS.</p>
        {envio && <div className="admin-feedback" role="status">Se o e-mail puder receber acesso, enviaremos um link seguro. Aguarde antes de solicitar novamente.</div>}
        <CustomerLoginForm next={safeNext} />
      </section>
    </PublicShell>
  );
}
