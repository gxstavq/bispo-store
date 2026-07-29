import type { PaymentProvider, PaymentRequest, PaymentResult } from "./payment-provider";

export class MockPaymentProvider implements PaymentProvider {
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    return {
      status: "pending",
      reference: `MOCK-${request.orderId}-${Math.round(request.amount * 100)}`,
      demo: true,
    };
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
