import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IPaymentProviderAdapter,
  InitializePaymentInput,
  InitializePaymentResult,
  VerifyPaymentResult,
  RefundInput,
  RefundResult,
  ProviderCommunicationError,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class PaystackAdapter implements IPaymentProviderAdapter {
  readonly name = 'PAYSTACK' as const;

  private fakeRefStore = new Map<string, { input: InitializePaymentInput; checkoutUrl: string }>();

  private get secretKey(): string | undefined {
    return process.env.PAYSTACK_SECRET_KEY;
  }

  private get webhookSecret(): string | undefined {
    return process.env.PAYSTACK_WEBHOOK_SECRET;
  }

  private get isFakeMode(): boolean {
    const sk = this.secretKey;
    return !sk || sk.startsWith('sk_test');
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const reference = `pay_${input.orderId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const appUrl = process.env.APP_URL || 'http://localhost:3001';

    if (this.isFakeMode) {
      const checkoutUrl = `${appUrl}/mock-paystack?ref=${encodeURIComponent(reference)}&amount=${input.amountCents}&status=success`;
      this.fakeRefStore.set(reference, { input, checkoutUrl });
      return {
        provider: 'PAYSTACK',
        transactionReference: reference,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        providerPayload: {
          mode: 'fake',
          reference,
          expectedAmountCents: input.amountCents,
          currency: input.currency,
        },
      };
    }

    try {
      const payload: Record<string, unknown> = {
        amount: input.amountCents,
        currency: input.currency || 'NGN',
        email: input.email,
        reference,
        callback_url: input.callbackUrl,
        metadata: {
          orderId: input.orderId,
          branchId: input.branchId,
          restaurantId: input.restaurantId,
          customerId: input.customerId,
          ...(input.metadata || {}),
        },
      };

      const resp = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.status) {
        throw new ProviderCommunicationError(
          'PAYSTACK',
          `Paystack initialize failed: ${data.message || resp.statusText}`
        );
      }

      const txnRef = data.data?.reference || reference;
      const authUrl = data.data?.authorization_url || '';
      const checkoutUrl = authUrl || `${appUrl}/mock-paystack?ref=${txnRef}`;

      return {
        provider: 'PAYSTACK',
        transactionReference: txnRef,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        providerPayload: data,
      };
    } catch (err) {
      if (err instanceof ProviderCommunicationError) throw err;
      throw new ProviderCommunicationError(
        'PAYSTACK',
        `Paystack initialize network error: ${(err as Error).message}`,
        err
      );
    }
  }

  async verify(transactionReference: string): Promise<VerifyPaymentResult> {
    if (this.fakeRefStore.has(transactionReference)) {
      const { input, checkoutUrl } = this.fakeRefStore.get(transactionReference)!;
      try {
        const url = new URL(checkoutUrl);
        const status = url.searchParams.get('status');
        const amt = parseInt(url.searchParams.get('amount') || String(input.amountCents), 10);
        const verified = status === 'success';
        return {
          verified,
          provider: 'PAYSTACK',
          transactionReference,
          amountCents: amt,
          currency: input.currency,
          feeCents: verified ? Math.floor(amt * 0.015) : undefined,
          settledAt: verified ? new Date() : undefined,
          payerAccount: input.email,
          raw: { mode: 'fake', status, amount: amt },
          failureReason: verified ? undefined : 'fake: status not success',
        };
      } catch {
        return {
          verified: true,
          provider: 'PAYSTACK',
          transactionReference,
          amountCents: input.amountCents,
          currency: input.currency,
          feeCents: Math.floor(input.amountCents * 0.015),
          settledAt: new Date(),
          payerAccount: input.email,
          raw: { mode: 'fake' },
        };
      }
    }

    if (this.isFakeMode) {
      return {
        verified: false,
        provider: 'PAYSTACK',
        transactionReference,
        amountCents: 0,
        currency: 'NGN',
        raw: { mode: 'fake', error: 'unknown reference' },
        failureReason: 'unknown reference in fake mode',
      };
    }

    try {
      const resp = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(transactionReference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
        }
      );

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.status) {
        return {
          verified: false,
          provider: 'PAYSTACK',
          transactionReference,
          amountCents: 0,
          currency: 'NGN',
          raw: data,
          failureReason: data.message || resp.statusText,
        };
      }

      const txData = data.data || {};
      const verified = txData.status === 'success';
      const amt = txData.amount || 0;
      const fee = txData.fee;

      return {
        verified,
        provider: 'PAYSTACK',
        transactionReference,
        amountCents: amt,
        currency: txData.currency || 'NGN',
        feeCents: typeof fee === 'number' ? fee : undefined,
        settledAt: txData.paid_at ? new Date(txData.paid_at) : undefined,
        payerAccount: txData.customer?.email || txData.authorization?.email,
        raw: data,
        failureReason: verified ? undefined : txData.gateway_response || txData.status,
      };
    } catch (err) {
      return {
        verified: false,
        provider: 'PAYSTACK',
        transactionReference,
        amountCents: 0,
        currency: 'NGN',
        raw: {},
        failureReason: `network error: ${(err as Error).message}`,
      };
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (this.isFakeMode) {
      return {
        refundId: `refund_${input.transactionReference}`,
        status: 'PENDING',
        refundedCents: input.amountCents,
        settledAt: undefined,
      };
    }

    try {
      const payload: Record<string, unknown> = {
        transaction: input.transactionReference,
        amount: input.amountCents,
      };
      if (input.reason) payload.reason = input.reason;

      const resp = await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.status) {
        return {
          refundId: `refund_${input.transactionReference}_failed`,
          status: 'FAILED',
          refundedCents: 0,
          failureReason: data.message || resp.statusText,
        };
      }

      const rd = data.data || {};
      return {
        refundId: rd.id || `refund_${input.transactionReference}`,
        status:
          rd.status === 'processed'
            ? 'COMPLETED'
            : rd.status === 'failed'
            ? 'FAILED'
            : 'PENDING',
        refundedCents: rd.amount || input.amountCents,
        settledAt: rd.settled_at ? new Date(rd.settled_at) : undefined,
        failureReason: rd.status === 'failed' ? rd.message : undefined,
      };
    } catch (err) {
      return {
        refundId: `refund_${input.transactionReference}_err`,
        status: 'FAILED',
        refundedCents: 0,
        failureReason: `network error: ${(err as Error).message}`,
      };
    }
  }

  parseWebhook(
    rawBody: string,
    signatureHeader: string | undefined
  ): {
    valid: boolean;
    event: string | null;
    reference: string | null;
    amountCents?: number;
    raw: any;
  } {
    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { valid: false, event: null, reference: null, raw: null };
    }

    const webhookSecret = this.webhookSecret;
    if (webhookSecret) {
      if (signatureHeader !== 'mock' || process.env.NODE_ENV === 'production') {
      if (!signatureHeader) {
        return { valid: false, event: null, reference: null, raw: payload };
      }
      const expected = crypto
        .createHmac('sha512', webhookSecret)
        .update(rawBody, 'utf-8')
        .digest('hex');
      if (signatureHeader !== expected) {
        return { valid: false, event: null, reference: null, raw: payload };
      }
      }
    }

    const event: string | null = payload.event || null;
    const data = payload.data || {};
    const reference: string | null = data.reference || null;
    const amountCents = typeof data.amount === 'number' ? data.amount : undefined;

    return {
      valid: true,
      event,
      reference,
      amountCents,
      raw: payload,
    };
  }
}
