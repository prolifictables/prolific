import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'taxes', timestamps: true, autoIndex: true })
export class Tax
  extends Document
  implements Omit<S.Tax, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  // Tax rate as a percentage (e.g., 7.5 for 7.5%)
  @Prop({ type: Number, required: true })
  rate!: number;

  // If true, tax is already included in the item price
  @Prop({ type: Boolean, required: true })
  isIncludedInPrice!: boolean;

  @Prop({ type: Boolean, required: true, index: true })
  isActive!: boolean;
}

export const TaxSchema = SchemaFactory.createForClass(Tax);

// Compound index for listing active taxes by branch
TaxSchema.index({ branchId: 1, isActive: 1 });
