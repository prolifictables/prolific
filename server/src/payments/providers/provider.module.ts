import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaystackAdapter } from './paystack.adapter';
import { FlutterwaveAdapter } from './flutterwave.adapter';
import { TestAdapter } from './test.adapter';
import { PaymentProviderFactory } from './provider-factory';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    PaystackAdapter,
    FlutterwaveAdapter,
    TestAdapter,
    PaymentProviderFactory,
  ],
  exports: [PaymentProviderFactory],
})
export class ProviderModule {}
