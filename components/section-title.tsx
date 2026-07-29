import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionTitle({
  eyebrow,
  title,
  href,
  linkLabel = "Ver tudo",
}: {
  eyebrow: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow eyebrow--red">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {href && <Link href={href} className="text-link">{linkLabel} <ArrowRight size={17} /></Link>}
    </div>
  );
}
