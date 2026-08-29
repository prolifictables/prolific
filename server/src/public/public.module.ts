import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { QRCode, QRCodeSchema } from '../qr-codes/schemas/qr-code.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { TableSession, TableSessionSchema } from '../table-sessions/schemas/table-session.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { MenuCategory, MenuCategorySchema } from '../menu/schemas/menu-category.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { MenuModifier, MenuModifierSchema } from '../menu/schemas/menu-modifier.schema';
import { Tax, TaxSchema } from '../taxes/schemas/tax.schema';
import { Discount, DiscountSchema } from '../discounts/schemas/discount.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { KitchenOrder, KitchenOrderSchema } from '../orders/schemas/kitchen-order.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Setting, SettingSchema } from '../settings/schemas/setting.schema';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';
import { SocketModule } from '../socket/socket.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QRCode.name, schema: QRCodeSchema },
      { name: Table.name, schema: TableSchema },
      { name: TableSession.name, schema: TableSessionSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: MenuCategory.name, schema: MenuCategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuModifier.name, schema: MenuModifierSchema },
      { name: Tax.name, schema: TaxSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Order.name, schema: OrderSchema },
      { name: KitchenOrder.name, schema: KitchenOrderSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Setting.name, schema: SettingSchema },
    ]),
    forwardRef(() => OrdersModule),
    forwardRef(() => CustomersModule),
    forwardRef(() => PaymentsModule),
    SocketModule,
  ],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
