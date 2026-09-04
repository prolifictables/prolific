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
// Schemas for the @InjectModel(...) models SyncService actually uses.
// Registered DIRECTLY here via MongooseModule.forFeature() in SyncModule so
// NestJS DI can always resolve them — this avoids any subtle resolution
// failures from module import ordering, circular deps, or forgetting to
// re-export MongooseModule. MenuModule / TableSessionsModule are still
// imported as guards against any future service-injection need (and as
// defensive belt-and-suspenders), but the critical model registrations
// live locally below.
import { MenuCategory, MenuCategorySchema } from '../menu/schemas/menu-category.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { MenuModifier, MenuModifierSchema } from '../menu/schemas/menu-modifier.schema';
import { TableSession, TableSessionSchema } from '../table-sessions/schemas/table-session.schema';
import { MenuModule } from '../menu/menu.module';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SyncRecord.name, schema: SyncRecordSchema },
      // Local registrations for the models SyncService injects directly.
      // NestJS docs: these make MenuCategoryModel / MenuItemModel /
      // MenuModifierModel / TableSessionModel resolvable within SyncModule
      // (and exported to any importer thanks to `exports: [MongooseModule]`
      //  below — which re-exports all forFeature registrations above).
      { name: MenuCategory.name, schema: MenuCategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuModifier.name, schema: MenuModifierSchema },
      { name: TableSession.name, schema: TableSessionSchema },
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
  // Re-export MongooseModule so any consumer of SyncModule also gets the
  // model registrations above (belt-and-suspenders; doesn't hurt).
  exports: [SyncService, MongooseModule],
})
export class SyncModule {}
