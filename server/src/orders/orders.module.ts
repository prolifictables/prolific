import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Order, OrderSchema } from './schemas/order.schema';
import {
  KitchenOrder,
  KitchenOrderSchema,
} from './schemas/kitchen-order.schema';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
// Import host modules that export MongooseModule for the models we need
import { MenuModule } from '../menu/menu.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { TaxesModule } from '../taxes/taxes.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { CustomersModule } from '../customers/customers.module';
import { TablesModule } from '../tables/tables.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { UsersModule } from '../users/users.module';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: KitchenOrder.name, schema: KitchenOrderSchema },
    ]),
    // Host modules that export MongooseModule for MenuItem, Discount, Tax,
    // TableSession, Customer, InventoryItem, InventoryTransaction, Recipe, etc.
    MenuModule,
    DiscountsModule,
    TaxesModule,
    TableSessionsModule,
    CustomersModule,
    TablesModule,
    InventoryModule,
    LoyaltyModule,
    ShiftsModule,
    UsersModule,
    EmployeesModule,
    // JwtModule for verifying short-lived manager approval tokens
    JwtModule.register({}),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [MongooseModule, OrdersService],
})
export class OrdersModule {}
