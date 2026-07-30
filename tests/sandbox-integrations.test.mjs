import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizePagBankStatus, pagBankCheckoutTotalCents } from "../services/pagbank/status.ts";
import { shouldRefreshMelhorEnvioToken } from "../services/melhor-envio/token-policy.ts";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase", "migrations", "20260727175000_sandbox_integrations.sql"), "utf8");
const orderApi = readFileSync(join(root, "app", "api", "orders", "[id]", "route.ts"), "utf8");
const webhook = readFileSync(join(root, "app", "api", "webhooks", "pagbank", "route.ts"), "utf8");
const quoteService = readFileSync(join(root, "services", "shipping", "quote-service.ts"), "utf8");
const paymentService = readFileSync(join(root, "services", "pagbank", "payment-service.ts"), "utf8");
const labelService = readFileSync(join(root, "services", "melhor-envio", "label-service.ts"), "utf8");

test("entrega local aprovada e recusada mantêm o pagamento bloqueado até definição do frete", () => {
  assert.match(orderApi, /local_delivery_approved[\s\S]*shipping_amount: 0/);
  assert.match(orderApi, /local_delivery_rejected[\s\S]*shipping_amount: null/);
  assert.match(paymentService, /entrega local ainda não foi aprovada/i);
  assert.match(paymentService, /frete precisa estar definido/i);
});

test("frete normal ignora preço do navegador e invalida carrinho alterado", () => {
  assert.doesNotMatch(quoteService, /item\.(?:price|unitPrice)/);
  assert.match(quoteService, /promotional_price \?\? product\.price/);
  assert.match(migration, /shipping_quote_cart_changed/);
  assert.match(migration, /shipping_quote_stale/);
  assert.match(migration, /expires_at > now\(\)/);
});

test("crédito e Pix aprovados, boleto pendente e pagamento recusado são normalizados", () => {
  assert.deepEqual(normalizePagBankStatus({ payments: [{ status: "PAID", payment_method: { type: "CREDIT_CARD" } }] }), {
    status: "paid", rawStatus: "PAID", method: "CREDIT_CARD",
  });
  assert.equal(normalizePagBankStatus({ payments: [{ status: "PAID", payment_method: { type: "PIX" } }] }).status, "paid");
  assert.equal(normalizePagBankStatus({ payments: [{ status: "WAITING", payment_method: { type: "BOLETO" } }] }).status, "pending");
  assert.equal(normalizePagBankStatus({ payments: [{ status: "IN_ANALYSIS" }] }).status, "in_analysis");
  assert.equal(normalizePagBankStatus({ payments: [{ status: "DECLINED" }] }).status, "declined");
});

test("total consultado inclui produtos e frete", () => {
  assert.equal(pagBankCheckoutTotalCents({
    items: [{ unit_amount: 10000, quantity: 2 }],
    shipping: { amount: 2500 },
  }), 22500);
});

test("webhook duplicado é idempotente e consulta o PagBank antes de confirmar", () => {
  assert.match(migration, /payment_events_provider_event_uidx/);
  assert.match(webhook, /eventError\?\.code === "23505"/);
  assert.match(webhook, /consultPagBankCheckout/);
  assert.match(webhook, /confirm_pagbank_payment/);
  assert.match(migration, /stock_deducted_at is null/);
});

test("falhas de provedores, criação incerta e estoque insuficiente são registrados", () => {
  assert.match(quoteService, /recordIntegrationError/);
  assert.match(paymentService, /creation_uncertain/);
  assert.match(paymentService, /recordIntegrationError/);
  assert.match(migration, /Estoque insuficiente/);
});

test("token expirado é renovado com margem de segurança", () => {
  const now = Date.parse("2026-07-27T12:00:00Z");
  assert.equal(shouldRefreshMelhorEnvioToken("2026-07-27T12:04:00Z", now), true);
  assert.equal(shouldRefreshMelhorEnvioToken("2026-07-27T13:00:00Z", now), false);
});

test("etiqueta exige configuração fiscal e nunca usa declaração de conteúdo", () => {
  assert.match(labelService, /assertMelhorEnvioLabelPurchaseEnabled/);
  assert.match(labelService, /STORE_CNPJ/);
  assert.match(labelService, /invoice: \{ key: invoiceKey \}/);
  assert.doesNotMatch(labelService, /content_declaration/i);
});
