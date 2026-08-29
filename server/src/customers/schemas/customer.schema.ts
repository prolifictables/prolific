import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'customers', timestamps: true, autoIndex: true })
export class Customer
  extends Document
  implements Omit<S.Customer, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  // Branch-level isolation — a customer may be associated with a specific branch
  @Prop({ type: String })
  branchId?: string;

  @Prop({ type: String })
  firstName?: string;

  @Prop({ type: String })
  lastName?: string;

  @Prop({ type: String })
  email?: string;

  @Prop({ type: String })
  phone?: string;

  @Prop({ type: String })
  address?: string;

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: String })
  loyaltyAccountId?: string;

  @Prop({ type: Number, required: true, default: 0 })
  totalVisits!: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalSpent!: number;

  @Prop({ type: Date })
  lastVisitAt?: Date;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

// Sparse unique: email must be unique within a branch when present
CustomerSchema.index(
  { branchId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $ne: null } } }
);

// Sparse unique: phone must be unique within a branch when present
CustomerSchema.index(
  { branchId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $exists: true, $ne: null } } }
);
