import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { hasSupabasePublicEnv } from "@/lib/supabase/env";
import type { StoreOrder } from "@/types/commerce";

const orderSelect = `
  id,
  order_number,
  status,
  delivery_choice,
  subtotal,
  shipping_amount,
  payment_status,
  shipping_status,
  notes,
  created_at,
  customers!inner(id, full_name, whatsapp, email),
  addresses!inner(id, postal_code, street, number, complement, district, city, state, reference),
  order_items(id, product_id, quantity, unit_price, product_snapshot),
  shipping_decisions(id, decision, note, decided_at, decided_by),
  payments(
    id, status, external_reference, checkout_id, payment_url, payment_method,
    raw_status, expires_at, created_at,
    payment_events(id, provider_status, verified, verification_error, received_at)
  ),
  selected_quote:shipping_quotes!orders_selected_shipping_quote_id_fkey(
    id, carrier_name, service_id, service_name, amount, delivery_days, expires_at
  ),
  shipment_labels(
    melhor_envio_order_id, carrier_name, service_name, status,
    tracking_code, print_url, last_error, created_at
  ),
  order_status_history(id, from_status, to_status, note, changed_by, created_at)
`;

type OrderRecord = {
  id: string;
  order_number: string;
  status: StoreOrder["status"];
  delivery_choice: StoreOrder["deliveryChoice"];
  subtotal: number | string;
  shipping_amount: number | string | null;
  payment_status: StoreOrder["paymentStatus"];
  shipping_status: StoreOrder["shippingStatus"];
  notes: string | null;
  created_at: string;
  customers: { full_name: string; whatsapp: string; email: string } | Array<{ full_name: string; whatsapp: string; email: string }>;
  addresses: {
    postal_code: string;
    street: string;
    number: string;
    complement: string | null;
    district: string;
    city: string;
    state: string;
    reference: string | null;
  } | Array<{
    postal_code: string;
    street: string;
    number: string;
    complement: string | null;
    district: string;
    city: string;
    state: string;
    reference: string | null;
  }>;
  order_items: Array<{
    product_id: string | null;
    quantity: number;
    unit_price: number | string;
    product_snapshot: { name?: string; code?: string; size?: string; color?: string };
  }>;
  shipping_decisions: Array<{
    decision: "local_approved" | "local_rejected" | "conventional_selected";
    note: string;
    decided_at: string;
    decided_by: string;
  }>;
  payments: Array<{
    status: string;
    external_reference: string | null;
    checkout_id: string | null;
    payment_url: string | null;
    payment_method: string | null;
    raw_status: string | null;
    expires_at: string | null;
    created_at: string;
    payment_events: Array<{
      id: string;
      provider_status: string | null;
      verified: boolean;
      verification_error: string | null;
      received_at: string;
    }>;
  }>;
  selected_quote: {
    id: string;
    carrier_name: string;
    service_id: string;
    service_name: string;
    amount: number | string;
    delivery_days: number;
    expires_at: string;
  } | Array<{
    id: string;
    carrier_name: string;
    service_id: string;
    service_name: string;
    amount: number | string;
    delivery_days: number;
    expires_at: string;
  }> | null;
  shipment_labels: Array<{
    melhor_envio_order_id: string | null;
    carrier_name: string | null;
    service_name: string | null;
    status: string;
    tracking_code: string | null;
    print_url: string | null;
    last_error: string | null;
    created_at: string;
  }>;
  order_status_history: Array<{
    from_status: string | null;
    to_status: string;
    note: string | null;
    changed_by: string | null;
    created_at: string;
  }>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function mapOrder(row: OrderRecord): StoreOrder {
  const customer = one(row.customers);
  const address = one(row.addresses);
  const decisions = [...(row.shipping_decisions ?? [])].sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  const lastDecision = decisions[0];
  const latestPayment = [...(row.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const selectedQuote = row.selected_quote ? one(row.selected_quote) : null;
  const latestLabel = [...(row.shipment_labels ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const localStatus = lastDecision?.decision === "local_approved"
    ? "approved"
    : lastDecision?.decision === "local_rejected"
      ? "rejected"
      : row.delivery_choice === "local_delivery_review"
        ? "pending"
        : "not_requested";
  const history = [
    ...(row.order_status_history ?? []).map((entry) => ({
      date: formatDate(entry.created_at),
      label: entry.from_status ? `Status alterado para ${entry.to_status}` : `Pedido criado com status ${entry.to_status}`,
      actor: entry.changed_by ?? undefined,
      note: entry.note ?? undefined,
    })),
    ...decisions.map((decision) => ({
      date: formatDate(decision.decided_at),
      label: decision.decision === "local_approved"
        ? "Entrega local grátis aprovada"
        : decision.decision === "local_rejected"
          ? "Entrega local grátis recusada"
          : "Frete convencional selecionado",
      actor: decision.decided_by,
      note: decision.note,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    id: row.order_number,
    createdAt: formatDate(row.created_at),
    createdAtIso: row.created_at,
    customer: {
      fullName: customer.full_name,
      whatsapp: customer.whatsapp,
      email: customer.email,
      cep: address.postal_code,
      street: address.street,
      number: address.number,
      complement: address.complement ?? "",
      district: address.district,
      city: address.city,
      state: address.state,
      reference: address.reference ?? "",
      notes: row.notes ?? "",
      deliveryChoice: row.delivery_choice,
    },
    items: (row.order_items ?? []).map((item) => ({
      productId: item.product_id ?? "",
      size: item.product_snapshot.size ?? "",
      color: item.product_snapshot.color ?? "",
      quantity: item.quantity,
      productName: item.product_snapshot.name,
      productCode: item.product_snapshot.code,
      unitPrice: Number(item.unit_price),
    })),
    subtotal: Number(row.subtotal),
    deliveryChoice: row.delivery_choice,
    shippingAmount: row.shipping_amount === null ? null : Number(row.shipping_amount),
    shippingStatus: row.shipping_status,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentReference: latestPayment?.external_reference ?? undefined,
    payment: latestPayment ? {
      checkoutId: latestPayment.checkout_id ?? undefined,
      paymentUrl: latestPayment.payment_url ?? undefined,
      method: latestPayment.payment_method ?? undefined,
      providerStatus: latestPayment.raw_status ?? undefined,
      createdAt: formatDate(latestPayment.created_at),
      expiresAt: latestPayment.expires_at ? formatDate(latestPayment.expires_at) : undefined,
      events: [...(latestPayment.payment_events ?? [])]
        .sort((a, b) => b.received_at.localeCompare(a.received_at))
        .map((event) => ({
          id: event.id,
          status: event.provider_status ?? undefined,
          verified: event.verified,
          date: formatDate(event.received_at),
          error: event.verification_error ?? undefined,
        })),
    } : undefined,
    shippingQuote: selectedQuote ? {
      id: selectedQuote.id,
      carrier: selectedQuote.carrier_name,
      serviceId: selectedQuote.service_id,
      service: selectedQuote.service_name,
      amount: Number(selectedQuote.amount),
      deliveryDays: selectedQuote.delivery_days,
      expiresAt: selectedQuote.expires_at,
    } : undefined,
    shipmentLabel: latestLabel ? {
      providerOrderId: latestLabel.melhor_envio_order_id ?? undefined,
      carrier: latestLabel.carrier_name ?? undefined,
      service: latestLabel.service_name ?? undefined,
      status: latestLabel.status,
      trackingCode: latestLabel.tracking_code ?? undefined,
      printUrl: latestLabel.print_url ?? undefined,
      lastError: latestLabel.last_error ?? undefined,
    } : undefined,
    localDeliveryReview: {
      status: localStatus,
      note: lastDecision?.note,
      decidedBy: lastDecision?.decided_by,
      decidedAt: lastDecision ? formatDate(lastDecision.decided_at) : undefined,
    },
    history,
  };
}

export interface OrderRepository {
  list(): Promise<StoreOrder[]>;
  findById(id: string): Promise<StoreOrder | null>;
}

export class SupabaseOrderRepository implements OrderRepository {
  async list() {
    if (!hasSupabasePublicEnv()) return [];
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("orders").select(orderSelect).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as OrderRecord[]).map(mapOrder);
  }

  async findById(orderNumber: string) {
    if (!hasSupabasePublicEnv()) return null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("orders")
      .select(orderSelect)
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapOrder(data as unknown as OrderRecord) : null;
  }
}

export const orderRepository: OrderRepository = new SupabaseOrderRepository();

export async function findOrderForVerifiedReturn(orderNumber: string) {
  if (!hasSupabasePublicEnv()) return null;
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapOrder(data as unknown as OrderRecord) : null;
}
