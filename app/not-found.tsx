import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export default function NotFound() {
  return (
    <PublicShell>
      <section className="not-found container">
        <span>404</span>
        <div><small>ROTA FORA DO MAPA</small><h1>Essa página<br />saiu de cena.</h1><p>O endereço pode ter mudado ou ainda não entrou no drop.</p><Link href="/" className="button button--red"><ArrowLeft size={18} /> Voltar ao início</Link></div>
      </section>
    </PublicShell>
  );
}
