import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { EnvValidationSchema } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { EmployeesModule } from './employees/employees.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { BranchesModule } from './branches/branches.module';
import { SettingsModule } from './settings/settings.module';
import { DevicesModule } from './devices/devices.module';
import { MenuModule } from './menu/menu.module';
import { TaxesModule } from './taxes/taxes.module';
import { DiscountsModule } from './discounts/discounts.module';
import { TablesModule } from './tables/tables.module';
import { QrCodesModule } from './qr-codes/qr-codes.module';
import { CustomersModule } from './customers/customers.module';
import { TableSessionsModule } from './table-sessions/table-sessions.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { SyncModule } from './sync/sync.module';
import { ReportsModule } from './reports/reports.module';
import { SocketModule } from './socket/socket.module';
import { SeedModule } from './seed/seed.module';
import { PublicModule } from './public/public.module';
import { HealthModule } from './health/health.module';
import { PosModule } from './pos/pos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Use Zod via the validate() callback (ConfigModule expects Joi for
      // validationSchema, but our env.validation.ts exports Zod; this wraps it).
      validate: (config) => {
        const parsed = EnvValidationSchema.safeParse(config);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `[${i.path.join('.')}] ${i.message}`)
            .join('; ');
          throw new Error(`Environment validation failed: ${issues}`);
        }
        return parsed.data;
      },
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI || '', {
      retryAttempts: 10,
      retryDelay: 3000,
      serverSelectionTimeoutMS: 5000,
    }),
    ScheduleModule.forRoot(),

    AuthModule,
    RbacModule,
    AuditModule,
    UsersModule,
    EmployeesModule,
    RestaurantsModule,
    BranchesModule,
    SettingsModule,
    DevicesModule,
    MenuModule,
    TaxesModule,
    DiscountsModule,
    TablesModule,
    QrCodesModule,
    CustomersModule,
    TableSessionsModule,
    OrdersModule,
    PaymentsModule,
    InventoryModule,
    SuppliersModule,
    LoyaltyModule,
    SyncModule,
    ReportsModule,
    SocketModule,
    SeedModule,
    PublicModule,
    HealthModule,
    PosModule,
  ],
  providers: [
    // JWT guard on all routes by default. Public routes use @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
