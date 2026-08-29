export interface InitializePaymentInput {
  amountCents: number;
  currency: string;
  email: string;
  customerName?: string;
  phone?: string;
  orderId: string;
  restaurantId: string;
  branchId: string;
  customerId?: string;
  tableId?: string;
  sessionId?: string;
  metadata?: Record<string, string | number | boolean>;
  callbackUrl: string;
  webhookUrl: string;
  idempotencyKey: string;
}

export interface InitializePaymentResult {
  provider: 'PAYSTACK' | 'FLUTTERWAVE' | 'TEST';
  transactionReference: string;
  authorizationUrl: string;
  checkoutSessionId?: string;
  expiresAt: Date;
  raw: unknown;
}

export interface VerifyPaymentResult {
  provider: 'PAYSTACK' | 'FLUTTERWAVE' | 'TEST';
  transactionReference: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amountCents: number;
  paidAmountCents: number;
  currency: string;
  paidAt: Date;
  customerEmail?: string;
  feesCents?: number;
  raw: unknown;
}

export interface RefundInput {
  amountCents: number;
  transactionReference: string;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  provider: string;
  status: 'SUCCESS' | 'FAILED' | 'PROCESSING';
  refundReference: string;
  raw: unknown;
}

export interface IPaymentProviderAdapter {
  readonly name: 'PAYSTACK' | 'FLUTTERWAVE' | 'TEST';

  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verify(transactionReference: string): Promise<VerifyPaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;

  parseWebhook(
    signatureHeader: string | undefined,
    rawBody: Buffer
  ): Promise<{ eventType: string; data: any }>;
}
