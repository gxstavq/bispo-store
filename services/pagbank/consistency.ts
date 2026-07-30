function cents(value: number | string) {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

export function storedPagBankPaymentMatchesOrder(input: {
  paymentAmount: number | string;
  orderTotal: number | string;
  orderNumber: string | undefined;
  webhookReferenceId?: string;
}) {
  return Boolean(input.orderNumber)
    && cents(input.paymentAmount) === cents(input.orderTotal)
    && (
      !input.webhookReferenceId
      || input.webhookReferenceId === input.orderNumber
    );
}

export function consultedPagBankCheckoutMatchesPayment(input: {
  checkoutId: string | undefined;
  referenceId: string | undefined;
  totalCents: number;
  expectedCheckoutId: string;
  expectedOrderNumber: string;
  expectedAmount: number | string;
}) {
  return input.checkoutId === input.expectedCheckoutId
    && input.referenceId === input.expectedOrderNumber
    && input.totalCents === cents(input.expectedAmount);
}

export function pagBankChargeAmountCents(input: {
  amount?: {
    value?: number;
    summary?: { total?: number };
  };
}) {
  const amount = Number(input.amount?.value ?? input.amount?.summary?.total);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function consultedPagBankOrderMatchesPayment(input: {
  providerOrderId: string | undefined;
  referenceId: string | undefined;
  chargeId: string | undefined;
  chargeAmountCents: number | null;
  expectedProviderOrderId: string;
  expectedChargeId?: string;
  expectedOrderNumber: string;
  expectedAmount: number | string;
}) {
  return input.providerOrderId === input.expectedProviderOrderId
    && input.referenceId === input.expectedOrderNumber
    && (!input.expectedChargeId || input.chargeId === input.expectedChargeId)
    && input.chargeAmountCents === cents(input.expectedAmount);
}
