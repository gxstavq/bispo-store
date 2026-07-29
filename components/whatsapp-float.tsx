"use client";

import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { whatsappUrl } from "@/lib/format";

export function WhatsappFloat() {
  const pathname = usePathname();
  let message = "Olá! Preciso de ajuda com a loja.";
  if (pathname.startsWith("/produto/")) {
    const productName = pathname.split("/").pop()?.replaceAll("-", " ") ?? "este produto";
    message = `Olá! Tenho uma dúvida sobre o produto ${productName}.`;
  } else if (pathname.startsWith("/pedido-recebido")) {
    const order = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("pedido") ?? "de demonstração";
    message = `Olá! Preciso de ajuda com o pedido ${order}.`;
  }

  return (
    <a className="whatsapp-float" href={whatsappUrl(message)} target="_blank" rel="noreferrer" aria-label="Falar com a Bispo Store no WhatsApp">
      <MessageCircle size={24} />
      <span>WhatsApp</span>
    </a>
  );
}
