import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFileSync(join(root, ...file.split("/")), "utf8");
const adminMigration = source("supabase/migrations/20260731210000_admin_final_review.sql");

test("checkout temporário cria o pedido e abre o WhatsApp sem chamar o PagBank", () => {
  const checkout = source("components/checkout-form.tsx");
  assert.match(checkout, /completionMode === "whatsapp"/);
  assert.match(checkout, /window\.location\.assign\(whatsappUrl\(orderWhatsappSummary\(order\)\)\)/);
  assert.match(checkout, /Finalizar pedido pelo WhatsApp/);
  assert.match(checkout, /nossa equipe enviará o link seguro de pagamento do PagBank pelo WhatsApp/);
  assert.ok(
    checkout.indexOf('completionMode === "whatsapp"') < checkout.indexOf("createPaymentCheckout(orderId)"),
    "o desvio para WhatsApp precisa ocorrer antes da chamada automática ao PagBank",
  );
});

test("modo PagBank permanece preservado e depende de ativação explícita", () => {
  const mode = source("lib/checkout-mode.ts");
  const checkout = source("components/checkout-form.tsx");
  assert.match(mode, /CHECKOUT_COMPLETION_MODE === "pagbank"/);
  assert.match(mode, /: "whatsapp"/);
  assert.match(checkout, /createPaymentCheckout\(orderId\)/);
  assert.match(checkout, /window\.location\.assign\(payment\.paymentUrl\)/);
});

test("resumo do WhatsApp contém pedido, cliente, itens, frete, valores e endereço", () => {
  const summary = source("lib/orders/whatsapp-summary.ts");
  const format = source("lib/format.ts");
  for (const expected of [
    "Finalizei meu pedido na Bispo Store",
    "Pedido:",
    "Cliente:",
    "Telefone:",
    "Produtos:",
    "Tamanho:",
    "Cor:",
    "Subtotal:",
    "Modalidade de frete:",
    "Prazo estimado:",
    "Valor do frete:",
    "Total:",
    "CEP:",
    "Endereço:",
  ]) assert.match(summary, new RegExp(expected));
  assert.match(format, /encodeURIComponent\(message\)/);
  assert.match(format, /5511972938269/);
});

test("pedido com frete nasce aguardando pagamento sem criar Checkout PagBank", () => {
  const route = source("app/api/orders/route.ts");
  assert.match(route, /deliveryChoice === "shipping_quote"/);
  assert.match(route, /update\(\{ payment_status: "awaiting_payment" \}\)/);
  assert.doesNotMatch(route, /createPagBankCheckoutForOrder|createPaymentCheckout/);
});

test("somente administrador confirma manualmente após conferência explícita", () => {
  const route = source("app/api/orders/[id]/route.ts");
  const service = source("services/orders/manual-payment.ts");
  assert.match(route, /const \{ user, admin \} = await requireAdmin\(\)/);
  assert.match(route, /input\.paymentChecked !== true/);
  assert.match(route, /confirmManualPagBankPayment/);
  assert.match(service, /createSupabaseServerClient/);
  assert.match(service, /confirm_manual_order_payment/);
  assert.match(adminMigration, /from public\.confirm_pagbank_payment/);
  assert.match(adminMigration, /manual_payment_confirmed_by_admin/);
  assert.match(adminMigration, /changed_by = target_actor_user_id/);
  assert.doesNotMatch(service, /product_variants[\s\S]*\.update\(\{ stock:/);
});

test("confirmação e cancelamento preservam idempotência e reservas", () => {
  const route = source("app/api/orders/[id]/route.ts");
  assert.match(adminMigration, /selected_order\.stock_deducted_at/);
  assert.match(adminMigration, /on conflict \(provider, provider_event_id\)/);
  assert.match(adminMigration, /'manual-payment-confirmed-' \|\| selected_order\.id::text/);
  assert.match(adminMigration, /release_reason = 'admin_cancelled_whatsapp_order'/);
  assert.match(route, /payment_status === "paid" \|\| row\.stock_deducted_at/);
  assert.match(route, /cancelManualPaymentAndReleaseReservation/);
});
