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
// SyncService injects @InjectModel(MenuCategory / MenuItem / MenuModifier) and
// @InjectModel(TableSession) for the POS→cloud command handlers. The models
// themselves are registered for DI via MenuModule and TableSessionsModule
// (both export MongooseModule), so importing them here resolves the Nest DI
// error: "Nest can't resolve dependencies of the SyncService ... MenuCategoryModel".
import { MenuModule } from '../menu/menu.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';

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
    MenuModule,
    TableSessionsModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
    }),
  ],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService, MongooseModule],
})
export class SyncModule {}
