import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tax, TaxSchema } from './schemas/tax.schema';
import { TaxesController } from './taxes.controller';
import { TaxesService } from './taxes.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Tax.name, schema: TaxSchema }])],
  controllers: [TaxesController],
  providers: [TaxesService],
  exports: [MongooseModule, TaxesService],
})
export class TaxesModule {}
