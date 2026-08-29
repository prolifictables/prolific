import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Supplier, SupplierSchema } from './schemas/supplier.schema';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from './schemas/purchase-order.schema';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Supplier.name, schema: SupplierSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    InventoryModule,
  ],
  providers: [SuppliersService],
  controllers: [SuppliersController],
  exports: [MongooseModule, SuppliersService],
})
export class SuppliersModule {}
