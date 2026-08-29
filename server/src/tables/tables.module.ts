import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Table, TableSchema } from './schemas/table.schema';
import { TablesService } from './tables.service';
import { TablesController } from './tables.controller';
import { TableSessionsModule } from '../table-sessions/table-sessions.module';
import { QrCodesModule } from '../qr-codes/qr-codes.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Table.name, schema: TableSchema }]),
    TableSessionsModule,
    QrCodesModule,
  ],
  providers: [TablesService],
  controllers: [TablesController],
  exports: [MongooseModule, TablesService],
})
export class TablesModule {}
