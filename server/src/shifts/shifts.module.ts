import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shift, ShiftSchema } from './schemas/shift.schema';
import {
  CashAdjustment,
  CashAdjustmentSchema,
} from './schemas/cash-adjustment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shift.name, schema: ShiftSchema },
      { name: CashAdjustment.name, schema: CashAdjustmentSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ShiftsModule {}
