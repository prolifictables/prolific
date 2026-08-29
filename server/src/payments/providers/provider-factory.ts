import { Injectable } from '@nestjs/common';
import { PaystackAdapter } from './paystack.adapter';
import { FlutterwaveAdapter } from './flutterwave.adapter';
import { TestAdapter } from './test.adapter';
import { IPaymentProviderAdapter } from './payment-provider.interface';

type ProviderName = 'PAYSTACK' | 'FLUTTERWAVE' | 'TEST';

@Injectable()
export class PaymentProviderFactory {
  private instanceCache = new Map<ProviderName, IPaymentProviderAdapter>();

  constructor(
    private readonly paystackAdapter: PaystackAdapter,
    private readonly flutterwaveAdapter: FlutterwaveAdapter,
    private readonly testAdapter: TestAdapter
  ) {}

  getAdapter(name?: ProviderName): IPaymentProviderAdapter {
    const resolvedName: ProviderName =
      name ??
      ((process.env.PAYMENT_PROVIDER?.toUpperCase() as ProviderName) || 'TEST');

    if (this.instanceCache.has(resolvedName)) {
      return this.instanceCache.get(resolvedName)!;
    }

    let adapter: IPaymentProviderAdapter;
    switch (resolvedName) {
      case 'PAYSTACK':
        adapter = this.paystackAdapter;
        break;
      case 'FLUTTERWAVE':
        adapter = this.flutterwaveAdapter;
        break;
      case 'TEST':
      default:
        adapter = this.testAdapter;
        break;
    }

    this.instanceCache.set(resolvedName, adapter);
    return adapter;
  }
}
