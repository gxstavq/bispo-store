import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, readJsonBody, validationErrorResponse } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateCartItems, validateCheckoutData } from "@/lib/validation/commerce";
import { orderRepository } from "@/repositories/order-repository";
import { lookupPostalAddress, PostalCodeLookupError } from "@/services/address/viacep";
import { isValidOrderIdempotencyKey } from "@/lib/orders/idempotency-key";
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
  const idempotencyKey = request.headers.get("idempotency-key");
  try {
    assertSameOrigin(request);
    if (!isValidOrderIdempotencyKey(idempotencyKey)) {
      return NextResponse.json(
        { error: "Chave de idempotência ausente ou inválida." },
        { status: 400 },
      );
    }
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

  try {
    const resolvedAddress = await lookupPostalAddress(input.customer.cep);
    input.customer = { ...input.customer, state: resolvedAddress.state };
  } catch (error) {
    if (error instanceof PostalCodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({
      error: "Não foi possível validar o CEP antes de criar o pedido.",
    }, { status: 503 });
  }

  if (input.customer.deliveryChoice === "local_delivery_review" && input.customer.state !== "SP") {
    return NextResponse.json({
      error: "A análise de entrega local está disponível somente para endereços em SP.",
    }, { status: 400 });
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
      state: input.customer.state,
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
    requested_idempotency_key: idempotencyKey,
  });
  if (error) {
    if (
      error.code === "55P03"
      || error.message.includes("lock timeout")
      || error.message.includes("insufficient_available_stock")
      || error.message.includes("variant_unavailable")
    ) {
      return NextResponse.json(
        { error: "Um dos itens acabou de ficar sem estoque. Revise o carrinho e tente novamente." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Pedido não criado: ${error.message}` }, { status: 400 });
  }
  const orderNumber = Array.isArray(data) ? data[0]?.order_number : data?.order_number;
  const order = orderNumber ? await orderRepository.findById(orderNumber) : null;
  return order
    ? NextResponse.json(order, { status: 201 })
    : NextResponse.json({ error: "Pedido criado, mas não pôde ser recarregado." }, { status: 500 });
}
