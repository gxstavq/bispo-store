import type {
  DeliveryChoice,
  LocalDeliveryReviewStatus,
  OrderStatus,
  PaymentStatus,
  ShippingStatus,
} from "@/types/commerce";

export const orderStatuses: OrderStatus[] = [
  "awaiting_local_delivery_review",
  "local_delivery_approved",
  "local_delivery_rejected",
  "awaiting_shipping_selection",
  "awaiting_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
];

export const orderStatusLabels: Record<OrderStatus, string> = {
  awaiting_local_delivery_review: "Aguardando análise da entrega local",
  local_delivery_approved: "Entrega local aprovada",
  local_delivery_rejected: "Entrega local recusada",
  awaiting_shipping_selection: "Aguardando seleção de frete",
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago",
  preparing: "Em preparação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export const deliveryChoiceLabels: Record<DeliveryChoice, string> = {
  local_delivery_review: "Análise de entrega local grátis em até 5 km",
  shipping_quote: "Calcular frete para o endereço",
};

export const localReviewLabels: Record<LocalDeliveryReviewStatus, string> = {
  not_requested: "Não solicitada",
  pending: "Aguardando análise",
  approved: "Aprovada",
  rejected: "Recusada",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  not_generated: "Pagamento ainda não liberado",
  awaiting_payment: "Aguardando pagamento",
  in_analysis: "Em análise",
  paid: "Pago",
  declined: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

export const shippingStatusLabels: Record<ShippingStatus, string> = {
  awaiting_review: "Aguardando análise local",
  awaiting_selection: "Aguardando seleção de frete",
  free_approved: "Entrega local grátis",
  selected: "Frete convencional selecionado",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};
