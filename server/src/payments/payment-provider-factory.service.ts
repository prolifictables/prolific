import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { FlutterwaveAdapter } from './adapters/flutterwave.adapter';
import {
  IPaymentProviderAdapter,
  PaymentProvider,
} from './interfaces/payment-provider.interface';

@Injectable()
export class PaymentProviderFactory {
  private adapters: Map<PaymentProvider, IPaymentProviderAdapter>;

  constructor(
    @Inject(forwardRef(() => PaystackAdapter))
    private paystack: PaystackAdapter,
    @Inject(forwardRef(() => FlutterwaveAdapter))
    private flutterwave: FlutterwaveAdapter
  ) {
    this.adapters = new Map<PaymentProvider, IPaymentProviderAdapter>([
      ['PAYSTACK', paystack],
      ['FLUTTERWAVE', flutterwave],
    ]);
  }

  get(provider: PaymentProvider): IPaymentProviderAdapter {
    const a = this.adapters.get(provider);
    if (!a) {
      throw new BadRequestException(`Unsupported provider ${provider}`);
    }
    return a;
  }

  pickForBranch(
    branchPreference?: PaymentProvider | null
  ): IPaymentProviderAdapter {
    const pref =
      (branchPreference as PaymentProvider) ||
      ((process.env.DEFAULT_PAYMENT_PROVIDER as PaymentProvider) || 'PAYSTACK');
    return this.get(pref);
  }
}
