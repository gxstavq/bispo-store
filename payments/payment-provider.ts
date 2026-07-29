export interface PaymentRequest {
  orderId: string;
  amount: number;
}

export interface PaymentResult {
  status: "approved" | "pending";
  reference: string;
  demo: true;
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
}
