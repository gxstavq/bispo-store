import { PublicShell } from "./public-shell";

export function LegalPage({
  eyebrow,
  title,
  updated = "27 de julho de 2026",
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <PublicShell>
      <section className="legal-hero">
        <div className="container"><span>{eyebrow}</span><h1>{title}</h1><p>Versão preliminar para validação do projeto.</p></div>
      </section>
      <article className="legal-content container">
        <aside><span>Última atualização</span><strong>{updated}</strong><em>Conteúdo demonstrativo — revisar antes da publicação.</em></aside>
        <div className="legal-copy">{children}</div>
      </article>
    </PublicShell>
  );
}
