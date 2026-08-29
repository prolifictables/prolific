import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'tables', timestamps: true, autoIndex: true })
export class Table
  extends Document
  implements Omit<S.Table, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Number, required: true })
  capacity!: number;

  @Prop({ type: String })
  floor?: string;

  @Prop({ type: String })
  zone?: string;

  @Prop({
    type: { x: { type: Number, required: true }, y: { type: Number, required: true } },
    _id: false,
  })
  position?: { x: number; y: number };

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: String, required: true, unique: true })
  qrCodeId!: string;
}

export const TableSchema = SchemaFactory.createForClass(Table);

// Compound unique index: branchId + name (table identifier, e.g. "Table 12")
TableSchema.index({ branchId: 1, name: 1 }, { unique: true });

// Index for querying tables by branch, zone, and active status
TableSchema.index({ branchId: 1, zone: 1, isActive: 1 });
