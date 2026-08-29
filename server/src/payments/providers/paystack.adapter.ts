import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  IPaymentProviderAdapter,
  InitializePaymentInput,
  InitializePaymentResult,
  VerifyPaymentResult,
  RefundInput,
  RefundResult,
} from './payment-provider.interface';

class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

@Injectable()
export class PaystackAdapter implements IPaymentProviderAdapter {
  readonly name = 'PAYSTACK' as const;

  private initCache = new Map<string, InitializePaymentInput>();

  constructor(private readonly configService: ConfigService) {}

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private get secretKey(): string | undefined {
    return this.configService.get<string>('PAYSTACK_SECRET_KEY');
  }

  private get publicKey(): string | undefined {
    return this.configService.get<string>('PAYSTACK_PUBLIC_KEY');
  }

  private get webhookSecret(): string | undefined {
    return this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET');
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    if (!this.secretKey && this.isProduction) {
      throw new NotImplementedError(
        'PAYSTACK_SECRET_KEY is required in production. Need to wire fetch later.'
      );
    }

    const reference = `paystack_test_${input.orderId}_${Date.now()}`;
    this.initCache.set(reference, input);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    if (this.secretKey && this.isProduction) {
      throw new NotImplementedError('Need to wire fetch later for Paystack initialize.');
    }

    return {
      provider: 'PAYSTACK',
      transactionReference: reference,
      authorizationUrl: `http://localhost:3000/test-paystack?ref=${encodeURIComponent(reference)}&amount=${input.amountCents}`,
      checkoutSessionId: `sess_${reference}`,
      expiresAt,
      raw: {
        test: true,
        reference,
        expectedAmount: input.amountCents,
        currency: input.currency,
      },
    };
  }

  async verify(transactionReference: string): Promise<VerifyPaymentResult> {
    if (transactionReference.startsWith('paystack_test_')) {
      const input = this.initCache.get(transactionReference);
      const amount = input?.amountCents ?? 0;
      return {
        provider: 'PAYSTACK',
        transactionReference,
        status: 'SUCCESS',
        amountCents: amount,
        paidAmountCents: amount,
        currency: input?.currency ?? 'NGN',
        paidAt: new Date(),
        customerEmail: input?.email,
        feesCents: Math.floor(amount * 0.015),
        raw: {
          test: true,
          verified: true,
          reference: transactionReference,
          orderId: input?.orderId,
          metadata: input?.metadata,
        },
      };
    }

    if (this.secretKey && this.isProduction) {
      throw new NotImplementedError('Need to wire fetch later for Paystack verify.');
    }

    return {
      provider: 'PAYSTACK',
      transactionReference,
      status: 'FAILED',
      amountCents: 0,
      paidAmountCents: 0,
      currency: 'NGN',
      paidAt: new Date(),
      raw: { error: 'Unknown reference in non-prod mode' },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (this.secretKey && this.isProduction) {
      throw new NotImplementedError('Need to wire fetch later for Paystack refund.');
    }

    return {
      provider: 'PAYSTACK',
      status: 'SUCCESS',
      refundReference: `refund_${input.transactionReference}`,
      raw: { test: true, refundedAmount: input.amountCents },
    };
  }

  async parseWebhook(
    signatureHeader: string | undefined,
    rawBody: Buffer
  ): Promise<{ eventType: string; data: any }> {
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      payload = {};
    }

    if (!this.webhookSecret) {
      return {
        eventType: payload.event ?? payload.eventType ?? 'unknown',
        data: payload.data ?? payload,
      };
    }

    if (!signatureHeader) {
      throw new Error('Paystack webhook signature missing');
    }

    const expected = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (signatureHeader !== expected) {
      throw new Error('Paystack webhook signature mismatch');
    }

    return {
      eventType: payload.event ?? payload.eventType ?? 'unknown',
      data: payload.data ?? payload,
    };
  }
}
