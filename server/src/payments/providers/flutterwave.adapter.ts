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
export class FlutterwaveAdapter implements IPaymentProviderAdapter {
  readonly name = 'FLUTTERWAVE' as const;

  private initCache = new Map<string, InitializePaymentInput>();

  constructor(private readonly configService: ConfigService) {}

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private get secretKey(): string | undefined {
    return this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
  }

  private get publicKey(): string | undefined {
    return this.configService.get<string>('FLUTTERWAVE_PUBLIC_KEY');
  }

  private get webhookHash(): string | undefined {
    return this.configService.get<string>('FLUTTERWAVE_WEBHOOK_HASH');
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    if (!this.secretKey && this.isProduction) {
      throw new NotImplementedError(
        'FLUTTERWAVE_SECRET_KEY is required in production. Need to wire fetch later.'
      );
    }

    const reference = `flutterwave_test_${input.orderId}_${Date.now()}`;
    this.initCache.set(reference, input);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    if (this.secretKey && this.isProduction) {
      throw new NotImplementedError('Need to wire fetch later for Flutterwave initialize.');
    }

    return {
      provider: 'FLUTTERWAVE',
      transactionReference: reference,
      authorizationUrl: `http://localhost:3000/test-flutterwave?ref=${encodeURIComponent(reference)}&amount=${input.amountCents}`,
      checkoutSessionId: `fw_sess_${reference}`,
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
    if (transactionReference.startsWith('flutterwave_test_')) {
      const input = this.initCache.get(transactionReference);
      const amount = input?.amountCents ?? 0;
      return {
        provider: 'FLUTTERWAVE',
        transactionReference,
        status: 'SUCCESS',
        amountCents: amount,
        paidAmountCents: amount,
        currency: input?.currency ?? 'NGN',
        paidAt: new Date(),
        customerEmail: input?.email,
        feesCents: Math.floor(amount * 0.014),
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
      throw new NotImplementedError('Need to wire fetch later for Flutterwave verify.');
    }

    return {
      provider: 'FLUTTERWAVE',
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
      throw new NotImplementedError('Need to wire fetch later for Flutterwave refund.');
    }

    return {
      provider: 'FLUTTERWAVE',
      status: 'SUCCESS',
      refundReference: `fw_refund_${input.transactionReference}`,
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

    if (!this.webhookHash) {
      return {
        eventType: payload.event ?? payload.eventType ?? payload.type ?? 'unknown',
        data: payload.data ?? payload,
      };
    }

    const bodyStr = rawBody.toString('utf-8');
    const expected = crypto
      .createHash('md5')
      .update(bodyStr + this.webhookHash)
      .digest('hex');

    if (!signatureHeader) {
      throw new Error('Flutterwave webhook verif-hash missing');
    }

    if (signatureHeader !== expected) {
      throw new Error('Flutterwave webhook hash mismatch');
    }

    return {
      eventType: payload.event ?? payload.eventType ?? payload.type ?? 'unknown',
      data: payload.data ?? payload,
    };
  }
}
