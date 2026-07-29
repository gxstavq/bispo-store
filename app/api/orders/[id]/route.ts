import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderRepository } from "@/repositories/order-repository";
import { createPagBankCheckoutForOrder } from "@/services/pagbank/payment-service";
import type { OrderStatus } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Autenticação obrigatória.", loginRequired: true }, { status: 401 });
  }
  const { id } = await params;
  const order = await orderRepository.findById(id);
  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  return order
    ? NextResponse.json(order)
    : NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, admin } = await requireAdmin();
  try {
    assertSameOrigin(request);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("orders")
    .select("id, status, subtotal, shipping_amount")
    .eq("order_number", id)
    .single();
  if (!row) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  let input: {
    action?: "approve_local" | "reject_local" | "choose_conventional" | "set_shipping" | "enable_payment" | "update_status";
    note?: string;
    shippingAmount?: number;
    status?: OrderStatus;
  };
  try {
    input = await readJsonBody<typeof input>(request, 16 * 1024);
  } catch (error) {
    return validationErrorResponse(error)!;
  }
  const note = input.note?.trim();
  if (!note) return NextResponse.json({ error: "A observação é obrigatória." }, { status: 400 });
  if (note.length > 2000) {
    return NextResponse.json({ error: "A observação deve ter no máximo 2.000 caracteres." }, { status: 400 });
  }

  let orderUpdate: Record<string, unknown> = {};
  let decision: "local_approved" | "local_rejected" | "conventional_selected" | null = null;
  let quote: { amount: number; service_name: string } | null = null;

  if (input.action === "approve_local") {
    orderUpdate = { status: "local_delivery_approved", shipping_amount: 0, shipping_status: "free_approved", payment_status: "not_generated" };
    decision = "local_approved";
  } else if (input.action === "reject_local") {
    orderUpdate = { status: "local_delivery_rejected", shipping_amount: null, shipping_status: "awaiting_selection", payment_status: "not_generated" };
    decision = "local_rejected";
  } else if (input.action === "choose_conventional") {
    orderUpdate = { status: "awaiting_shipping_selection", shipping_amount: null, shipping_status: "awaiting_selection", payment_status: "not_generated" };
  } else if (input.action === "set_shipping") {
    const amount = Number(input.shippingAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: "Informe um frete maior que zero." }, { status: 400 });
    }
    orderUpdate = { status: "awaiting_payment", shipping_amount: amount, shipping_status: "selected", payment_status: "not_generated" };
    decision = "conventional_selected";
    quote = { amount, service_name: "Frete convencional manual" };
  } else if (input.action === "enable_payment") {
    if (row.shipping_amount === null) return NextResponse.json({ error: "Defina o frete antes de liberar o pagamento." }, { status: 400 });
    orderUpdate = { status: "awaiting_payment", payment_status: "awaiting_payment" };
  } else if (
    input.action === "update_status"
    && input.status
    && [
      "awaiting_local_delivery_review", "local_delivery_approved", "local_delivery_rejected",
      "awaiting_shipping_selection", "awaiting_payment", "paid", "preparing",
      "shipped", "delivered", "cancelled",
    ].includes(input.status)
  ) {
    if (input.status === "paid") {
      return NextResponse.json({
        error: "O status pago somente pode ser confirmado pelo webhook verificado do PagBank.",
      }, { status: 400 });
    }
    orderUpdate = {
      status: input.status,
      ...(input.status === "shipped" ? { shipping_status: "shipped" } : {}),
      ...(input.status === "delivered" ? { shipping_status: "delivered" } : {}),
      ...(input.status === "cancelled" ? { payment_status: "cancelled", shipping_status: "cancelled" } : {}),
    };
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const { error: updateError } = await supabase.from("orders").update(orderUpdate).eq("id", row.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });
  if (decision) {
    const { error } = await supabase.from("shipping_decisions").insert({
      order_id: row.id,
      decision,
      note,
      decided_by: user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (quote) {
    const { error } = await supabase.from("shipping_quotes").insert({
      order_id: row.id,
      provider: "manual",
      service_name: quote.service_name,
      amount: quote.amount,
      selected: true,
      created_by: user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (input.action === "enable_payment") {
    try {
      await createPagBankCheckoutForOrder(id);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Não foi possível criar o Checkout PagBank Sandbox.",
      }, { status: 502 });
    }
  }
  const nextStatus = typeof orderUpdate.status === "string" ? orderUpdate.status : row.status;
  if (nextStatus !== row.status) {
    const { data: latestHistory } = await supabase
      .from("order_status_history")
      .select("id")
      .eq("order_id", row.id)
      .eq("to_status", nextStatus)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestHistory) {
      await supabase
        .from("order_status_history")
        .update({ note, changed_by: user.id })
        .eq("id", latestHistory.id);
    }
  } else {
    await supabase.from("order_status_history").insert({
      order_id: row.id,
      from_status: row.status,
      to_status: row.status,
      note,
      changed_by: user.id,
    });
  }

  const order = await orderRepository.findById(id);
  return NextResponse.json({
    ...order,
    decisionActor: admin.display_name ?? admin.email,
  });
}
