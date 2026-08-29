import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'menuCategories', timestamps: true, autoIndex: true })
export class MenuCategory
  extends Document
  implements Omit<S.MenuCategory, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Number, required: true })
  sortOrder!: number;

  @Prop({ type: Boolean, required: true, index: true })
  isActive!: boolean;

  @Prop({ type: String })
  imageUrl?: string;
}

export const MenuCategorySchema = SchemaFactory.createForClass(MenuCategory);

// Compound index: branchId + isActive + sortOrder for listing active categories in order
MenuCategorySchema.index({ branchId: 1, isActive: 1, sortOrder: 1 });
