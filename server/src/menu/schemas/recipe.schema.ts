import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as S from '@prolific/shared-types';

// Sub-document schema for individual recipe ingredients (embedded within Recipe)
@Schema({ _id: false })
export class RecipeIngredient extends Document {
  @Prop({ type: String, required: true })
  inventoryItemId!: string;

  @Prop({ type: String, required: true })
  inventoryItemName!: string;

  @Prop({ type: Number, required: true })
  quantity!: number;

  @Prop({ type: String, required: true, enum: Object.values(S.Unit) })
  unit!: S.Unit;

  // Cost snapshot at recipe creation time (INTEGER cents), optional
  @Prop({ type: Number })
  costAtRecipeTime?: number;
}

export const RecipeIngredientSchema = SchemaFactory.createForClass(RecipeIngredient);

@Schema({ collection: 'recipes', timestamps: true, autoIndex: true })
export class Recipe
  extends Document
  implements Omit<S.Recipe, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  // Each recipe maps to exactly one menu item (unique constraint)
  @Prop({ type: String, required: true, unique: true })
  menuItemId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Number, required: true })
  servings!: number;

  // Embedded array of recipe ingredients
  @Prop({ type: [RecipeIngredientSchema], default: [] })
  ingredients!: RecipeIngredient[];

  @Prop({ type: String })
  instructions?: string;

  @Prop({ type: Number })
  prepTimeMinutes?: number;

  @Prop({ type: Number })
  cookTimeMinutes?: number;
}

export const RecipeSchema = SchemaFactory.createForClass(Recipe);
