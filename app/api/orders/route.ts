import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateCartItems, validateCheckoutData } from "@/lib/validation/commerce";
import { orderRepository } from "@/repositories/order-repository";
import type { CartItem, CheckoutData } from "@/types/commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  return NextResponse.json(await orderRepository.list());
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({
      error: "Acesse sua conta por e-mail antes de finalizar o pedido.",
      loginRequired: true,
    }, { status: 401 });
  }
  let input: { items?: CartItem[]; customer?: CheckoutData };
  try {
    assertSameOrigin(request);
    const raw = await readJsonBody<{ items?: unknown; customer?: unknown }>(request);
    input = {
      items: validateCartItems(raw.items),
      customer: validateCheckoutData(raw.customer),
    };
    await enforceRateLimit({
      scope: "create-order",
      identifier: user.id,
      limit: 10,
      windowSeconds: 60 * 60,
    });
  } catch (error) {
    const response = validationErrorResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "Não foi possível validar o pedido." }, { status: 503 });
  }
  if (!input.items?.length || !input.customer) {
    return NextResponse.json({ error: "Itens e dados do cliente são obrigatórios." }, { status: 400 });
  }
  if (input.customer.state !== "SP") {
    return NextResponse.json({ error: "O endereço deve estar no estado de São Paulo." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_customer_order", {
    customer_data: {
      full_name: input.customer.fullName,
      whatsapp: input.customer.whatsapp,
      email: user.email ?? input.customer.email,
    },
    address_data: {
      postal_code: input.customer.cep,
      street: input.customer.street,
      number: input.customer.number,
      complement: input.customer.complement,
      district: input.customer.district,
      city: input.customer.city,
      state: "SP",
      reference: input.customer.reference,
    },
    cart_items: input.items.map((item) => ({
      product_id: item.productId,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
    })),
    requested_delivery_choice: input.customer.deliveryChoice,
    order_notes: input.customer.notes || null,
    selected_shipping_quote_id: input.customer.selectedShippingQuoteId ?? null,
  });
  if (error) return NextResponse.json({ error: `Pedido não criado: ${error.message}` }, { status: 400 });
  const orderNumber = Array.isArray(data) ? data[0]?.order_number : data?.order_number;
  const order = orderNumber ? await orderRepository.findById(orderNumber) : null;
  return order
    ? NextResponse.json(order, { status: 201 })
    : NextResponse.json({ error: "Pedido criado, mas não pôde ser recarregado." }, { status: 500 });
}
