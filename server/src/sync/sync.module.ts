import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { SyncRecord, SyncRecordSchema } from './schemas/sync-record.schema';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { CustomersModule } from '../customers/customers.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SyncRecord.name, schema: SyncRecordSchema },
    ]),
    OrdersModule,
    PaymentsModule,
    ShiftsModule,
    CustomersModule,
    AuditModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
    }),
  ],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService, MongooseModule],
})
export class SyncModule {}
