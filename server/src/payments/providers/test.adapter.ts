import { Injectable } from '@nestjs/common';
import {
  IPaymentProviderAdapter,
  InitializePaymentInput,
  InitializePaymentResult,
  VerifyPaymentResult,
  RefundInput,
  RefundResult,
} from './payment-provider.interface';

@Injectable()
export class TestAdapter implements IPaymentProviderAdapter {
  readonly name = 'TEST' as const;

  private initCache = new Map<string, InitializePaymentInput>();

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const reference = `test_${input.orderId}_${Date.now()}`;
    this.initCache.set(reference, input);

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    return {
      provider: 'TEST',
      transactionReference: reference,
      authorizationUrl: `${input.callbackUrl}?ref=${encodeURIComponent(reference)}&status=success`,
      checkoutSessionId: `test_sess_${reference}`,
      expiresAt,
      raw: {
        test: true,
        reference,
        expectedAmount: input.amountCents,
        currency: input.currency,
        orderId: input.orderId,
      },
    };
  }

  async verify(transactionReference: string): Promise<VerifyPaymentResult> {
    const input = this.initCache.get(transactionReference);
    const amount = input?.amountCents ?? 0;
    return {
      provider: 'TEST',
      transactionReference,
      status: 'SUCCESS',
      amountCents: amount,
      paidAmountCents: amount,
      currency: input?.currency ?? 'USD',
      paidAt: new Date(),
      customerEmail: input?.email,
      feesCents: 0,
      raw: {
        test: true,
        verified: true,
        reference: transactionReference,
        orderId: input?.orderId,
        metadata: input?.metadata,
      },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      provider: 'TEST',
      status: 'SUCCESS',
      refundReference: `test_refund_${input.transactionReference}`,
      raw: { test: true, refundedAmount: input.amountCents, reason: input.reason },
    };
  }

  async parseWebhook(
    _signatureHeader: string | undefined,
    rawBody: Buffer
  ): Promise<{ eventType: string; data: any }> {
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      payload = {};
    }
    return {
      eventType: payload.event ?? payload.eventType ?? payload.type ?? 'charge.success',
      data: payload.data ?? payload,
    };
  }
}
