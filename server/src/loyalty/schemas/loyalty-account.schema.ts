import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// LoyaltyAccount — per-restaurant loyalty balance for a customer
// A customer has one loyalty account per restaurant they frequent.
// ---------------------------------------------------------------------------

@Schema({ collection: 'loyaltyAccounts', timestamps: true, autoIndex: true })
export class LoyaltyAccount
  extends Document
  implements
    Omit<
      S.LoyaltyAccount,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'points'
      | 'tier'
      | 'pointsToNextTier'
      | 'lastPointsEarnedAt'
    >
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  customerId!: string;

  // Program tier / level
  @Prop({
    type: String,
    enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'],
  })
  programTier?: string;

  // Current redeemable points balance (integer)
  @Prop({ type: Number, required: true, default: 0 })
  pointsBalance!: number;

  // Lifetime total points ever earned (monotonic)
  @Prop({ type: Number, required: true, default: 0 })
  totalPointsEarned!: number;

  // Lifetime total points ever redeemed (monotonic)
  @Prop({ type: Number, required: true, default: 0 })
  totalPointsRedeemed!: number;

  @Prop({ type: Date })
  joinedAt?: Date;

  // Last time any point activity happened (earn/redeem)
  @Prop({ type: Date })
  lastActivityAt?: Date;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  // Referral code — globally unique, sparse (nullable)
  @Prop({ type: String, sparse: true, unique: true })
  referralCode?: string;

  // Who referred this customer (another loyalty account id or customer id)
  @Prop({ type: String })
  referredById?: string;
}

export const LoyaltyAccountSchema = SchemaFactory.createForClass(LoyaltyAccount);

// One customer can have only ONE loyalty account per restaurant
LoyaltyAccountSchema.index(
  { restaurantId: 1, customerId: 1 },
  { unique: true }
);
