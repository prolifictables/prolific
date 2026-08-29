import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'menuItems', timestamps: true, autoIndex: true })
export class MenuItem
  extends Document
  implements Omit<S.MenuItem, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true, index: true })
  categoryId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  // Stored as INTEGER cents to avoid float drift
  @Prop({ type: Number, required: true })
  price!: number;

  @Prop({ type: String })
  imageUrl?: string;

  @Prop({ type: String, required: true, enum: Object.values(S.MenuItemStatus), index: true })
  status!: S.MenuItemStatus;

  @Prop({ type: Number, required: true })
  sortOrder!: number;

  @Prop({ type: Boolean, required: true })
  isTaxable!: boolean;

  @Prop({ type: [String], required: true, default: [] })
  taxIds!: string[];

  @Prop({ type: [String], required: true, default: [] })
  modifierIds!: string[];

  @Prop({ type: String })
  recipeId?: string;

  @Prop({
    type: {
      daysOfWeek: { type: [Number], required: true },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
    },
  })
  scheduledAvailability?: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };

  // Version fields used by sync conflict detector
  @Prop({ type: Number, required: true, default: 0 })
  version!: number;

  @Prop({ type: Date, required: true, default: Date.now })
  lastModifiedAt!: Date;

  @Prop({ type: String, required: true })
  lastModifiedBy!: string;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);

// Compound index for listing items by branch, category, status, and sort order
MenuItemSchema.index({ branchId: 1, categoryId: 1, status: 1, sortOrder: 1 });

// Text index for search by name
MenuItemSchema.index({ name: 'text' });

// Unique compound index for version-based conflict detection
// NOTE: "id" is a mongoose virtual (not stored), so we index on _id.
MenuItemSchema.index({ _id: 1, version: 1 }, { unique: true });
