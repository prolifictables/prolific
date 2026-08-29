import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { Branch as IBranch } from '@prolific/shared-types';

export type OpeningHour = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

@Schema({ collection: 'branches', timestamps: true, autoIndex: true })
export class Branch extends Document implements Omit<IBranch, 'id' | 'createdAt' | 'updatedAt'> {
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  address!: string;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, required: true })
  country!: string;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, required: true, default: 'UTC' })
  timezone!: string;

  @Prop({ type: [Object], required: true, default: [] })
  openingHours!: OpeningHour[];

  @Prop({ type: Boolean, required: true, default: true, index: true })
  isActive!: boolean;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ restaurantId: 1, isActive: 1 });
