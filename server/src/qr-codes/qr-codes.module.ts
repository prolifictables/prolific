import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QRCode, QRCodeSchema } from './schemas/qr-code.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { QrCodesService } from './qr-codes.service';
import { QrCodesController } from './qr-codes.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QRCode.name, schema: QRCodeSchema },
      { name: Table.name, schema: TableSchema },
    ]),
  ],
  providers: [QrCodesService],
  controllers: [QrCodesController],
  exports: [MongooseModule, QrCodesService],
})
export class QrCodesModule {}
