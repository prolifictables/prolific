import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhooksController } from './payments.webhooks.controller';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { FlutterwaveAdapter } from './adapters/flutterwave.adapter';
import { PaymentProviderFactory } from './payment-provider-factory.service';
import { OrdersModule } from '../orders/orders.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { CustomersModule } from '../customers/customers.module';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    forwardRef(() => OrdersModule),
    ShiftsModule,
    CustomersModule,
    SocketModule,
    JwtModule.register({}),
  ],
  controllers: [PaymentsController, PaymentsWebhooksController],
  providers: [
    PaystackAdapter,
    FlutterwaveAdapter,
    PaymentProviderFactory,
    PaymentsService,
  ],
  exports: [
    MongooseModule,
    PaymentsService,
    PaymentProviderFactory,
    PaystackAdapter,
    FlutterwaveAdapter,
  ],
})
export class PaymentsModule {}
