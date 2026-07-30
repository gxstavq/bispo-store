import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  clearOrderIdempotencyKey,
  getOrCreateOrderIdempotencyKey,
} from "../lib/orders/idempotency-key.ts";
import { isValidOrderNumber, pagBankReturnUrl } from "../lib/orders/order-number.ts";
import { normalizePagBankStatus } from "../services/pagbank/status.ts";
import { pagBankWebhookIdentifiers } from "../services/pagbank/webhook-association.ts";
import {
  consultedPagBankCheckoutMatchesPayment,
  storedPagBankPaymentMatchesOrder,
} from "../services/pagbank/consistency.ts";
import { pagBankShippingServiceType } from "../services/pagbank/shipping.ts";
import {
  createCapabilityToken,
  verifyCapabilityToken,
} from "../lib/security/capability-token.ts";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260729200000_pagbank_idempotency_inventory_reservations.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(root, "supabase", "rollback", "20260729200000_pagbank_idempotency_inventory_reservations.rollback.sql"),
  "utf8",
);
const paymentConfirmationMigration = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "20260729204000_qualify_pagbank_payment_confirmation.sql",
  ),
  "utf8",
);
const paymentConfirmationRollback = readFileSync(
  join(
    root,
    "supabase",
    "rollback",
    "20260729204000_qualify_pagbank_payment_confirmation.rollback.sql",
  ),
  "utf8",
);
const webhook = readFileSync(join(root, "app", "api", "webhooks", "pagbank", "route.ts"), "utf8");
const returnPage = readFileSync(join(root, "app", "pedido-recebido", "page.tsx"), "utf8");
const paymentService = readFileSync(join(root, "services", "pagbank", "payment-service.ts"), "utf8");
const reservationService = readFileSync(
  join(root, "services", "inventory", "reservation-service.ts"),
  "utf8",
);

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("IN_ANALYSIS possui estado próprio e não é convertido em pending", () => {
  assert.deepEqual(
    normalizePagBankStatus({
      payments: [{ status: "IN_ANALYSIS", payment_method: { type: "CREDIT_CARD" } }],
    }),
    { status: "in_analysis", rawStatus: "IN_ANALYSIS", method: "CREDIT_CARD" },
  );
  assert.match(migration, /'awaiting_payment', 'in_analysis', 'paid'/);
  assert.match(migration, /confirmed_status = 'in_analysis'/);
  assert.match(migration, /greatest\(expires_at, now\(\) \+ interval '2 hours'\)/);
  assert.match(paymentService, /\["pending", "in_analysis", "paid"\]/);
});

test("retorno PagBank inclui e valida o número real do pedido", () => {
  const returnToken = createCapabilityToken(
    "chave-local-de-teste",
    "pagbank-order-return-v1",
    "BSP-12AB34CD",
  );
  const result = pagBankReturnUrl(
    "https://deploy-preview-1--bispo-store-homologacao.netlify.app/pedido-recebido",
    "BSP-12AB34CD",
    returnToken,
  );
  assert.equal(
    result,
    `https://deploy-preview-1--bispo-store-homologacao.netlify.app/pedido-recebido?pedido=BSP-12AB34CD&retorno=${returnToken}`,
  );
  assert.equal(
    verifyCapabilityToken(
      "chave-local-de-teste",
      "pagbank-order-return-v1",
      "BSP-12AB34CD",
      returnToken,
    ),
    true,
  );
  assert.equal(
    verifyCapabilityToken(
      "chave-local-de-teste",
      "pagbank-order-return-v1",
      "BSP-FFFFFFFF",
      returnToken,
    ),
    false,
  );
  assert.equal(isValidOrderNumber("BSP-12AB34CD"), true);
  assert.equal(isValidOrderNumber("../../admin"), false);
  assert.throws(() => pagBankReturnUrl("https://example.test/pedido-recebido", "invalido"));
  assert.match(paymentService, /createOrderReturnToken\(order\.order_number\)/);
});

test("frete PagBank envia somente service_type aceito pela API", () => {
  assert.equal(pagBankShippingServiceType("PAC"), "PAC");
  assert.equal(pagBankShippingServiceType("sedex"), "SEDEX");
  assert.equal(pagBankShippingServiceType("Jadlog Package"), undefined);
  assert.equal(pagBankShippingServiceType("Melhor Envio"), undefined);
  assert.equal(pagBankShippingServiceType(null), undefined);
});

test("página de retorno não considera o redirecionamento uma aprovação", () => {
  assert.match(returnPage, /O retorno do PagBank, sozinho, não confirma o pagamento/);
  assert.match(returnPage, /awaiting_payment:/);
  assert.match(returnPage, /in_analysis:/);
  assert.match(returnPage, /paid:/);
  assert.match(returnPage, /declined:/);
  assert.match(returnPage, /cancelled:/);
  assert.match(returnPage, /expired:/);
  assert.match(returnPage, /isValidOrderNumber\(pedido\)/);
  assert.match(returnPage, /verifyOrderReturnToken\(pedido, retorno\)/);
  assert.match(returnPage, /findOrderForVerifiedReturn\(pedido\)/);
  assert.doesNotMatch(returnPage, /if \(!user\) redirect/);
});

test("webhook usa checkout_id explícito e ignora id transacional", () => {
  assert.deepEqual(
    pagBankWebhookIdentifiers({
      checkout_id: "CHEC_123",
      reference_id: "BSP-12AB34CD",
      id: "CHAR_TRANSACIONAL_DIFERENTE",
    }),
    { checkoutId: "CHEC_123", referenceId: "BSP-12AB34CD" },
  );
  assert.deepEqual(
    pagBankWebhookIdentifiers({
      reference_id: "BSP-12AB34CD",
      id: "ORDE_TRANSACIONAL_DIFERENTE",
    }),
    { checkoutId: undefined, referenceId: "BSP-12AB34CD" },
  );
  assert.throws(() => pagBankWebhookIdentifiers({ id: "CHAR_ISOLADO" }));
  assert.doesNotMatch(webhook, /body\.checkout_id \?\? body\.id/);
});

test("webhook rejeita ambiguidade, referência e valor divergentes antes do evento", () => {
  assert.match(webhook, /matchingPayments\.length !== 1/);
  assert.match(webhook, /webhookReferenceId: identifiers\.referenceId/);
  assert.match(webhook, /expectedCheckoutId: payment\.checkout_id/);
  assert.match(webhook, /consultedPagBankCheckoutMatchesPayment/);
  const divergenceCheck = webhook.indexOf("consultedPagBankCheckoutMatchesPayment({");
  const eventInsert = webhook.indexOf('.from("payment_events").insert');
  assert.ok(divergenceCheck >= 0 && eventInsert > divergenceCheck);
  assert.equal(storedPagBankPaymentMatchesOrder({
    paymentAmount: 120,
    orderTotal: 120,
    orderNumber: "BSP-12AB34CD",
    webhookReferenceId: "BSP-DIVERGENTE",
  }), false);
  assert.equal(consultedPagBankCheckoutMatchesPayment({
    checkoutId: "CHEC_123",
    referenceId: "BSP-12AB34CD",
    totalCents: 11999,
    expectedCheckoutId: "CHEC_123",
    expectedOrderNumber: "BSP-12AB34CD",
    expectedAmount: 120,
  }), false);
});

test("cliques repetidos e requisições simultâneas reutilizam a mesma chave", async () => {
  const storage = memoryStorage();
  const fingerprint = JSON.stringify({ cart: [{ id: "produto", quantity: 1 }] });
  let generated = 0;
  const createKey = () => {
    generated += 1;
    return "123e4567-e89b-42d3-a456-426614174000";
  };
  const first = getOrCreateOrderIdempotencyKey(storage, fingerprint, createKey);
  const repeated = getOrCreateOrderIdempotencyKey(storage, fingerprint, createKey);
  const simultaneous = await Promise.all(
    Array.from({ length: 20 }, async () =>
      getOrCreateOrderIdempotencyKey(storage, fingerprint, createKey)),
  );
  assert.equal(first, repeated);
  assert.deepEqual(new Set(simultaneous), new Set([first]));
  assert.equal(generated, 1);
  assert.doesNotMatch(
    storage.getItem("bispo-store:order-idempotency"),
    /produto|quantity/,
  );
  clearOrderIdempotencyKey(storage);
});

test("idempotência server-side serializa a mesma chave e mantém uma restrição única", () => {
  assert.match(migration, /orders_customer_idempotency_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /idempotency_key_reused_with_different_payload/);
  assert.match(migration, /return query select existing_order\.order_number/);
});

test("última unidade é protegida por reserva e locks em ordem determinística", () => {
  assert.match(migration, /order by variant_id/);
  assert.match(migration, /for update/);
  assert.match(migration, /variant_stock - already_reserved < item_record\.quantity/);
  assert.match(migration, /insufficient_available_stock/);
  assert.match(migration, /reservations\.order_id <> order_record\.id/);
  assert.match(migration, /set stock = variants\.stock - items\.quantity/);
  assert.match(migration, /order_record\.stock_deducted_at is null/);
});

test("confirmação PagBank qualifica integralmente colunas potencialmente ambíguas", () => {
  assert.match(paymentConfirmationMigration, /payments\.checkout_id = target_checkout_id/);
  assert.match(paymentConfirmationMigration, /order_items\.order_id = selected_order\.id/);
  assert.match(paymentConfirmationMigration, /reservations\.order_id <> selected_order\.id/);
  assert.match(paymentConfirmationMigration, /reservations\.expires_at > now\(\)/);
  assert.match(paymentConfirmationMigration, /variants\.stock - coalesce/);
  assert.match(paymentConfirmationMigration, /where orders\.id = selected_order\.id/);
  assert.doesNotMatch(paymentConfirmationMigration, /where order_id\s*=/);
  assert.doesNotMatch(paymentConfirmationMigration, /where checkout_id\s*=/);
  assert.doesNotMatch(paymentConfirmationMigration, /where id\s*=/);
  assert.match(
    paymentConfirmationMigration,
    /returns table\(payment_id uuid, order_id uuid, stock_deducted boolean, stock_error text\)/,
  );
  assert.match(paymentConfirmationMigration, /to service_role/);
  assert.doesNotMatch(
    paymentConfirmationMigration,
    /integration_credentials|oauth_states|access_token|refresh_token/i,
  );
});

test("rollback da confirmação PagBank é estrutural e não remove dados", () => {
  assert.match(
    paymentConfirmationRollback,
    /confirm_pagbank_payment_pre_20260729204000/,
  );
  assert.doesNotMatch(
    paymentConfirmationRollback,
    /drop table|drop column|truncate\s|delete from public\./i,
  );
  assert.match(paymentConfirmationRollback, /to service_role/);
});

test("cancelamento e expiração liberam a reserva", () => {
  assert.match(migration, /status in \('active', 'consumed', 'released', 'expired'\)/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /orders_release_terminal_reservations/);
  assert.match(migration, /new\.payment_status in \('declined', 'expired', 'cancelled'\)/);
  assert.match(paymentService, /releaseOrderStockReservation/);
  assert.match(reservationService, /STOCK_RESERVATION_MINUTES = 120/);
});

test("migration é aditiva e rollback bloqueia perda de dados novos", () => {
  assert.doesNotMatch(migration, /drop table|drop column|truncate\s|delete from public\.(orders|products|product_variants|customers)/i);
  assert.match(rollback, /rollback_blocked_orders_use_new_pagbank_fields/);
  assert.match(rollback, /rollback_blocked_inventory_reservations_not_empty/);
});
