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
