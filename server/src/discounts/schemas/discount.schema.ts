import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'discounts', timestamps: true, autoIndex: true })
export class Discount
  extends Document
  implements Omit<S.Discount, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  // Discount type: PERCENTAGE (e.g., 10% off) or FIXED (flat amount off in cents)
  @Prop({ type: String, required: true, enum: ['PERCENTAGE', 'FIXED'] })
  type!: 'PERCENTAGE' | 'FIXED';

  // Discount value: percentage (e.g., 10) or fixed cents (e.g., 500 for $5.00)
  @Prop({ type: Number, required: true })
  value!: number;

  // Maximum discount amount cap in INTEGER cents (optional)
  @Prop({ type: Number })
  maxAmount?: number;

  // Minimum order amount in INTEGER cents required to apply discount (optional)
  @Prop({ type: Number })
  minOrderAmount?: number;

  @Prop({ type: Boolean, required: true, index: true })
  isActive!: boolean;

  @Prop({ type: Boolean, required: true })
  requiresManagerApproval!: boolean;

  // Threshold amount in cents above which manager PIN is required (optional)
  @Prop({ type: Number })
  approvalThreshold?: number;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);

// Compound index for listing active discounts by branch
DiscountSchema.index({ branchId: 1, isActive: 1 });
