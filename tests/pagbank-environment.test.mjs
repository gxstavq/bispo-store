import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  isPagBankPaymentUrl,
  resolvePagBankEnvironment,
} from "../lib/integrations/pagbank-environment.ts";

const root = process.cwd();
const source = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("PagBank seleciona exclusivamente as URLs oficiais de cada ambiente", () => {
  assert.deepEqual(resolvePagBankEnvironment("sandbox"), {
    environment: "sandbox",
    baseUrl: "https://sandbox.api.pagseguro.com",
  });
  assert.deepEqual(resolvePagBankEnvironment("production"), {
    environment: "production",
    baseUrl: "https://api.pagseguro.com",
  });
});

test("PagBank rejeita ambiente ausente ou diferente dos dois permitidos", () => {
  for (const value of [undefined, "", "prod", "preview", "development", "PRODUCTION"]) {
    assert.throws(
      () => resolvePagBankEnvironment(value),
      /PAGBANK_ENV deve ser sandbox ou production/,
    );
  }
});

test("URL PAY deve pertencer ao host oficial do ambiente selecionado", () => {
  assert.equal(
    isPagBankPaymentUrl(
      "https://pagamento.pagseguro.uol.com.br/pagamento?code=teste",
      "production",
    ),
    true,
  );
  assert.equal(
    isPagBankPaymentUrl(
      "https://sandbox.pagseguro.uol.com.br/v2/checkout/payment.html?code=teste",
      "sandbox",
    ),
    true,
  );
  assert.equal(
    isPagBankPaymentUrl(
      "https://sandbox.pagseguro.uol.com.br/v2/checkout/payment.html?code=teste",
      "production",
    ),
    false,
  );
  assert.equal(
    isPagBankPaymentUrl("https://pagamento.pagseguro.uol.com.br.evil.example/", "production"),
    false,
  );
  assert.equal(isPagBankPaymentUrl("http://pagamento.pagseguro.uol.com.br/", "production"), false);
});

test("cliente cria Checkout no caminho relativo do ambiente selecionado", () => {
  const client = source("services", "pagbank", "client.ts");
  const config = source("lib", "integrations", "config.ts");
  assert.match(client, /createPagBankCheckoutRequest[\s\S]*"\/checkouts"/);
  assert.match(client, /inactivatePagBankCheckout[\s\S]*`\/checkouts\/\$\{encodeURIComponent\(checkoutId\)\}\/inactivate`/);
  assert.doesNotMatch(client, /https:\/\/(?:sandbox\.)?api\.pagseguro\.com/);
  assert.match(config, /getPagBankEnvironment\(\)/);
  assert.match(config, /token: required\("PAGBANK_TOKEN"\)/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_PAGBANK|PAGBANK_(?:SANDBOX|PRODUCTION)_TOKEN/);
});

test("limpeza do Checkout de validação inativa o PagBank antes de liberar a reserva", () => {
  const route = source(
    "app", "api", "orders", "[id]", "payment-checkout", "cancel", "route.ts",
  );
  const externalCall = route.indexOf("await inactivatePagBankCheckout");
  const paymentUpdate = route.indexOf('.from("payments")', externalCall);
  const orderUpdate = route.indexOf('.from("orders")', paymentUpdate);
  assert.ok(externalCall > 0);
  assert.ok(paymentUpdate > externalCall);
  assert.ok(orderUpdate > paymentUpdate);
  assert.match(route, /orderRepository\.findById/);
  assert.match(route, /assertSameOrigin/);
  assert.match(route, /enforceRateLimit/);
  assert.match(route, /payment\.status === "paid"/);
  assert.match(route, /payment_status: "cancelled"/);
  assert.match(route, /event_type: payment\.checkout_id \? "checkout_inactivated"/);
  assert.match(route, /\["creation_failed", "cancelled"\]\.includes\(payment\.status\)/);
  assert.match(route, /raw_status: payment\.checkout_id \? "INACTIVE" : "NOT_CREATED"/);
});

test("metadados e idempotência registram o ambiente realmente selecionado", () => {
  const service = source("services", "pagbank", "payment-service.ts");
  const webhook = source("app", "api", "webhooks", "pagbank", "route.ts");
  assert.match(service, /pagbank:\$\{environment\}:checkout/);
  assert.match(service, /provider_payload: \{ environment, request_started: true \}/);
  assert.match(service, /payload: \{ checkout_id: response\.id, environment \}/);
  assert.doesNotMatch(service, /environment: "sandbox"|pagbank:sandbox/);
  assert.match(webhook, /getPagBankEnvironment\(\)\.environment/);
  assert.doesNotMatch(webhook, /environment: "sandbox"|sandbox_configuration_unavailable/);
  assert.match(service, /isPagBankPaymentUrl\(value, environment\)/);
});

test("URLs de retorno de produção exigem o domínio oficial e caminhos esperados", () => {
  const config = source("lib", "integrations", "config.ts");
  assert.match(config, /url\.origin !== "https:\/\/bispostorebr\.com\.br"/);
  assert.match(config, /"\/api\/webhooks\/pagbank"/);
  assert.match(config, /"\/pedido-recebido"/);
  assert.match(config, /url\.protocol !== "https:"/);
});
