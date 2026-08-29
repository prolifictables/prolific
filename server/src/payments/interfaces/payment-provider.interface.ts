export interface InitializePaymentInput {
  amountCents: number;
  currency: string;
  email: string;
  customerId?: string;
  orderId: string;
  branchId: string;
  restaurantId: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializePaymentResult {
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  transactionReference: string;
  checkoutUrl: string;
  expiresAt?: Date;
  providerPayload: Record<string, unknown>;
}

export interface VerifyPaymentResult {
  verified: boolean;
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  transactionReference: string;
  amountCents: number;
  currency: string;
  feeCents?: number;
  settledAt?: Date;
  payerAccount?: string;
  raw: Record<string, unknown>;
  failureReason?: string;
}

export interface RefundInput {
  transactionReference: string;
  amountCents: number;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  refundedCents: number;
  settledAt?: Date;
  failureReason?: string;
}

export interface IPaymentProviderAdapter {
  readonly name: 'PAYSTACK' | 'FLUTTERWAVE';
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verify(transactionReference: string): Promise<VerifyPaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(
    rawBody: string,
    signatureHeader: string | undefined
  ): {
    valid: boolean;
    event: string | null;
    reference: string | null;
    amountCents?: number;
    raw: any;
  };
}

export type PaymentProvider = 'PAYSTACK' | 'FLUTTERWAVE';

export class ProviderCommunicationError extends Error {
  readonly provider: string;
  readonly cause?: unknown;

  constructor(provider: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'ProviderCommunicationError';
    this.provider = provider;
    this.cause = cause;
  }
}
