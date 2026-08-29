import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'qrCodes', timestamps: true, autoIndex: true })
export class QRCode
  extends Document
  implements Omit<S.QRCode, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  tableId!: string;

  @Prop({ type: String, required: true })
  token!: string;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  // Flag for the primary/default QR code per table — only one true per branch+table
  @Prop({ type: Boolean, required: true, default: false })
  isDefault!: boolean;

  @Prop({ type: Date })
  printedAt?: Date;

  @Prop({ type: Date })
  lastScannedAt?: Date;
}

export const QRCodeSchema = SchemaFactory.createForClass(QRCode);

// Globally unique token — public QR scans use token only to resolve
QRCodeSchema.index({ token: 1 }, { unique: true });

// Sparse unique: only one default QR code per branch+table combination
QRCodeSchema.index(
  { branchId: 1, tableId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);
