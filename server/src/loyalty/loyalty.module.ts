import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LoyaltyAccount,
  LoyaltyAccountSchema,
} from './schemas/loyalty-account.schema';
import { Promotion, PromotionSchema } from './schemas/promotion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LoyaltyAccount.name, schema: LoyaltyAccountSchema },
      { name: Promotion.name, schema: PromotionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class LoyaltyModule {}
