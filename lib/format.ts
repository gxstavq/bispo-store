export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "5511972938269";

export const whatsappUrl = (message: string) =>
  `https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
