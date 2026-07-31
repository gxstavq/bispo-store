import { formatCurrency } from "@/lib/format";
import { deliveryChoiceLabels } from "@/lib/order-status";
import type { StoreOrder } from "@/types/commerce";

export function orderWhatsappSummary(order: StoreOrder) {
  const products = order.items.map((item) => {
    const name = item.productName ?? "Produto";
    return `- ${item.quantity}x ${name} | Tamanho: ${item.size} | Cor: ${item.color}`;
  });
  const shipping = order.shippingQuote
    ? `${order.shippingQuote.carrier} · ${order.shippingQuote.service}`
    : deliveryChoiceLabels[order.deliveryChoice];
  const deliveryTime = order.shippingQuote
    ? `${order.shippingQuote.deliveryDays} dia(s)`
    : "A confirmar pela Bispo Store";
  const shippingAmount = order.shippingAmount === null
    ? "A confirmar"
    : formatCurrency(order.shippingAmount);
  const total = order.subtotal + (order.shippingAmount ?? 0);
  const complement = order.customer.complement
    ? ` · ${order.customer.complement}`
    : "";

  return [
    "Olá! Finalizei meu pedido na Bispo Store e gostaria de receber o link de pagamento do PagBank.",
    "",
    `Pedido: ${order.id}`,
    `Cliente: ${order.customer.fullName}`,
    `Telefone: ${order.customer.whatsapp}`,
    "",
    "Produtos:",
    ...products,
    "",
    `Subtotal: ${formatCurrency(order.subtotal)}`,
    `Modalidade de frete: ${shipping}`,
    `Prazo estimado: ${deliveryTime}`,
    `Valor do frete: ${shippingAmount}`,
    `Total: ${formatCurrency(total)}`,
    "",
    `CEP: ${order.customer.cep}`,
    `Endereço: ${order.customer.street}, ${order.customer.number}${complement}`,
    `${order.customer.district} · ${order.customer.city}/${order.customer.state}`,
  ].join("\n");
}
