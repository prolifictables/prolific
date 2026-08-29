import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as S from '@prolific/shared-types';

// Sub-document schema for individual modifier options (embedded within MenuModifier)
@Schema({ _id: false })
export class MenuModifierOption extends Document implements Omit<S.ModifierOption, 'id'> {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  // Price delta in INTEGER cents (positive or negative)
  @Prop({ type: Number, required: true })
  priceDelta!: number;

  @Prop({ type: Boolean, default: false })
  isDefault?: boolean;
}

export const MenuModifierOptionSchema = SchemaFactory.createForClass(MenuModifierOption);

@Schema({ collection: 'menuModifiers', timestamps: true, autoIndex: true })
export class MenuModifier
  extends Document
  implements Omit<S.MenuModifier, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Boolean, required: true })
  required!: boolean;

  @Prop({ type: Boolean, required: true })
  multiSelect!: boolean;

  @Prop({ type: Number, required: true, default: 0 })
  minSelections!: number;

  @Prop({ type: Number, required: true, default: 1 })
  maxSelections!: number;

  // Embedded array of modifier options
  @Prop({ type: [MenuModifierOptionSchema], default: [] })
  options!: MenuModifierOption[];
}

export const MenuModifierSchema = SchemaFactory.createForClass(MenuModifier);
