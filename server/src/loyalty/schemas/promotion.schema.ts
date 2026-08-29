import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ---------------------------------------------------------------------------
// Promotion — coupon / discount rule for orders
// Note: S.Promotion does not currently exist in @prolific/shared-types,
// so this schema does not implement a shared-type interface.
// ---------------------------------------------------------------------------

// Promotion type enum (values inline — shared-types has no PromotionType yet)
const PROMOTION_TYPES = [
  'PERCENTAGE_OFF',
  'FIXED_OFF',
  'BOGO',
  'FREE_ITEM',
  'LOYALTY_POINTS_BONUS',
] as const;

type PromotionTypeValue = (typeof PROMOTION_TYPES)[number];

@Schema({ collection: 'promotions', timestamps: true, autoIndex: true })
export class Promotion extends Document {
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  // Null = applies to all branches of this restaurant
  @Prop({ type: String, index: true })
  branchId?: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  // Coupon-code style code — unique per restaurant when present
  @Prop({ type: String, sparse: true })
  code?: string;

  @Prop({
    type: String,
    required: true,
    enum: PROMOTION_TYPES as unknown as string[],
  })
  type!: PromotionTypeValue;

  // Value depends on type:
  //   PERCENTAGE_OFF → % (e.g. 10 = 10% off)
  //   FIXED_OFF → cents
  //   LOYALTY_POINTS_BONUS → integer bonus points
  //   BOGO/FREE_ITEM → unused (0 or undefined)
  @Prop({ type: Number })
  value?: number;

  // Flexible conditions bag. Structure:
  // {
  //   minOrderCents?: number;
  //   validCategoryIds?: string[];
  //   validItemIds?: string[];
  //   customerTierRequired?: 'BRONZE'|'SILVER'|'GOLD'|'PLATINUM';
  //   maxUsesPerCustomer?: number;
  //   weekdays?: number[];   // 0–6, Sun–Sat
  // }
  @Prop({ type: Object, default: undefined })
  conditions?: Record<string, unknown>;

  @Prop({ type: Date })
  startAt?: Date;

  @Prop({ type: Date })
  endAt?: Date;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  // Total times this promotion may be used across all customers
  @Prop({ type: Number })
  maxUsesTotal?: number;

  // Running counter of uses
  @Prop({ type: Number, required: true, default: 0 })
  currentUsesCount!: number;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);

// Sparse compound: coupon codes unique per restaurant when set
PromotionSchema.index(
  { restaurantId: 1, code: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { code: { $exists: true, $ne: null } },
  }
);

// Active-date range index for "which promos apply right now at this branch?"
PromotionSchema.index({ branchId: 1, isActive: 1, startAt: 1, endAt: 1 });
