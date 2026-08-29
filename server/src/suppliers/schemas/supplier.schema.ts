import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Supplier — vendor record for purchasing inventory
// A supplier can be restaurant-level (shared across branches) or
// branch-specific (branchId set).
// ---------------------------------------------------------------------------

@Schema({ collection: 'suppliers', timestamps: true, autoIndex: true })
export class Supplier
  extends Document
  implements Omit<S.Supplier, 'id' | 'createdAt' | 'updatedAt' | 'branchId'>
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  // Null = restaurant-level supplier (shared by all branches of the restaurant)
  @Prop({ type: String, index: true })
  branchId?: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  contactName?: string;

  @Prop({ type: String })
  email?: string;

  @Prop({ type: String })
  phone!: string;

  @Prop({ type: String })
  address?: string;

  @Prop({ type: String })
  city?: string;

  @Prop({ type: String })
  country?: string;

  @Prop({ type: String })
  taxId?: string;

  // Human-readable payment terms e.g. "Net 15", "COD"
  @Prop({ type: String })
  paymentTerms?: string;

  // Credit limit in cents (decimal for currency that has them)
  @Prop({ type: Number })
  creditLimitCents?: number;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: String })
  notes?: string;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);

// Typical list: show active suppliers for a restaurant
SupplierSchema.index({ restaurantId: 1, isActive: 1 });

// Sparse compound: prevent duplicate email per restaurant when email is set
SupplierSchema.index(
  { email: 1, restaurantId: 1 },
  {
    sparse: true,
    unique: false,
    partialFilterExpression: { email: { $exists: true, $ne: null } },
  }
);
