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
export class FlutterwaveAdapter implements IPaymentProviderAdapter {
  readonly name = 'FLUTTERWAVE' as const;

  private fakeRefStore = new Map<string, { input: InitializePaymentInput; checkoutUrl: string }>();

  private get secretKey(): string | undefined {
    return process.env.FLUTTERWAVE_SECRET_KEY;
  }

  private get webhookSecret(): string | undefined {
    return process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  }

  private get isFakeMode(): boolean {
    const sk = this.secretKey;
    return !sk || sk.startsWith('FLWSECK_TEST-');
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const txRef = `fw_${input.orderId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const appUrl = process.env.APP_URL || 'http://localhost:3001';

    if (this.isFakeMode) {
      const checkoutUrl = `${appUrl}/mock-flutterwave?ref=${encodeURIComponent(txRef)}&amount=${input.amountCents}&status=success`;
      this.fakeRefStore.set(txRef, { input, checkoutUrl });
      return {
        provider: 'FLUTTERWAVE',
        transactionReference: txRef,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        providerPayload: {
          mode: 'fake',
          tx_ref: txRef,
          expectedAmountCents: input.amountCents,
          currency: input.currency,
        },
      };
    }

    try {
      const payload: Record<string, unknown> = {
        tx_ref: txRef,
        amount: Math.round(input.amountCents / 100),
        currency: input.currency || 'NGN',
        redirect_url: input.callbackUrl,
        customer: {
          email: input.email,
        },
        meta: {
          orderId: input.orderId,
          branchId: input.branchId,
          restaurantId: input.restaurantId,
          customerId: input.customerId,
          ...(input.metadata || {}),
        },
      };

      const resp = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || data.status !== 'success') {
        throw new ProviderCommunicationError(
          'FLUTTERWAVE',
          `Flutterwave initialize failed: ${data.message || resp.statusText}`
        );
      }

      const ref = data.data?.tx_ref || txRef;
      const link = data.data?.link || '';
      const checkoutUrl = link || `${appUrl}/mock-flutterwave?ref=${ref}`;

      return {
        provider: 'FLUTTERWAVE',
        transactionReference: ref,
        checkoutUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        providerPayload: data,
      };
    } catch (err) {
      if (err instanceof ProviderCommunicationError) throw err;
      throw new ProviderCommunicationError(
        'FLUTTERWAVE',
        `Flutterwave initialize network error: ${(err as Error).message}`,
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
          provider: 'FLUTTERWAVE',
          transactionReference,
          amountCents: amt,
          currency: input.currency,
          feeCents: verified ? Math.floor(amt * 0.014) : undefined,
          settledAt: verified ? new Date() : undefined,
          payerAccount: input.email,
          raw: { mode: 'fake', status, amount: amt },
          failureReason: verified ? undefined : 'fake: status not success',
        };
      } catch {
        return {
          verified: true,
          provider: 'FLUTTERWAVE',
          transactionReference,
          amountCents: input.amountCents,
          currency: input.currency,
          feeCents: Math.floor(input.amountCents * 0.014),
          settledAt: new Date(),
          payerAccount: input.email,
          raw: { mode: 'fake' },
        };
      }
    }

    if (this.isFakeMode) {
      return {
        verified: false,
        provider: 'FLUTTERWAVE',
        transactionReference,
        amountCents: 0,
        currency: 'NGN',
        raw: { mode: 'fake', error: 'unknown reference' },
        failureReason: 'unknown reference in fake mode',
      };
    }

    try {
      const isNumericId = /^[0-9]+$/.test(transactionReference);
      const url = isNumericId
        ? `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionReference)}/verify`
        : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(
            transactionReference
          )}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || data.status !== 'success') {
        return {
          verified: false,
          provider: 'FLUTTERWAVE',
          transactionReference,
          amountCents: 0,
          currency: 'NGN',
          raw: data,
          failureReason: data.message || resp.statusText,
        };
      }

      const txData = data.data || {};
      const verified = txData.status === 'successful';
      const amountNgn = txData.amount || 0;
      const amountCents = Math.round(amountNgn * 100);
      const feeNgn = txData.app_fee;

      return {
        verified,
        provider: 'FLUTTERWAVE',
        transactionReference,
        amountCents,
        currency: txData.currency || 'NGN',
        feeCents: typeof feeNgn === 'number' ? Math.round(feeNgn * 100) : undefined,
        settledAt: txData.completed_at ? new Date(txData.completed_at) : undefined,
        payerAccount: txData.customer?.email,
        raw: data,
        failureReason: verified ? undefined : txData.processor_response || txData.status,
      };
    } catch (err) {
      return {
        verified: false,
        provider: 'FLUTTERWAVE',
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
        refundId: `fw_refund_${input.transactionReference}`,
        status: 'PENDING',
        refundedCents: input.amountCents,
        settledAt: undefined,
      };
    }

    try {
      const payload: Record<string, unknown> = {
        id: input.transactionReference,
        amount: Math.round(input.amountCents / 100),
      };
      if (input.reason) payload.comments = input.reason;

      const resp = await fetch('https://api.flutterwave.com/v3/refunds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || data.status !== 'success') {
        return {
          refundId: `fw_refund_${input.transactionReference}_failed`,
          status: 'FAILED',
          refundedCents: 0,
          failureReason: data.message || resp.statusText,
        };
      }

      const rd = data.data || {};
      return {
        refundId: rd.id || `fw_refund_${input.transactionReference}`,
        status:
          rd.status === 'completed'
            ? 'COMPLETED'
            : rd.status === 'failed'
            ? 'FAILED'
            : 'PENDING',
        refundedCents: rd.amount ? Math.round(rd.amount * 100) : input.amountCents,
        settledAt: rd.completed_at ? new Date(rd.completed_at) : undefined,
        failureReason: rd.status === 'failed' ? rd.comments : undefined,
      };
    } catch (err) {
      return {
        refundId: `fw_refund_${input.transactionReference}_err`,
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
      const isMock = signatureHeader === 'mock' && process.env.NODE_ENV !== 'production';
      if (!isMock) {
        if (!signatureHeader) {
          return { valid: false, event: null, reference: null, raw: payload };
        }

        const expectedLegacy = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody, 'utf-8')
          .digest('hex');

        const ok = signatureHeader === webhookSecret || signatureHeader === expectedLegacy;
        if (!ok) {
          return { valid: false, event: null, reference: null, raw: payload };
        }
      }
    }

    const event: string | null = payload.event || payload.type || null;
    const data = payload.data || {};
    const reference: string | null = data.tx_ref || null;
    let amountCents: number | undefined = undefined;
    if (typeof data.amount === 'number') {
      amountCents = Math.round(data.amount * 100);
    }

    return {
      valid: true,
      event,
      reference,
      amountCents,
      raw: payload,
    };
  }
}
