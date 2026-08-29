import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Sub-document: Reference to an order attached to the table session
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class TableSessionOrderRef extends Document {
  @Prop({ type: String, required: true })
  orderId!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  addedAt!: Date;

  @Prop({ type: String })
  addedBy?: string;
}

export const TableSessionOrderRefSchema =
  SchemaFactory.createForClass(TableSessionOrderRef);

// ---------------------------------------------------------------------------
// Sub-document: Split payment group — partitions order items for separate bills
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class SplitGroup extends Document {
  @Prop({ type: String, required: true })
  groupId!: string;

  @Prop({ type: String })
  name?: string;

  @Prop({ type: [String], required: true, default: [] })
  orderItemIds!: string[];

  @Prop({ type: Number, required: true, default: 0 })
  subtotal!: number;

  @Prop({ type: Number, required: true, default: 0 })
  taxAmount!: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalAmount!: number;

  @Prop({ type: String })
  assignedTo?: string;
}

export const SplitGroupSchema = SchemaFactory.createForClass(SplitGroup);

// ---------------------------------------------------------------------------
// Main document: TableSession
// ---------------------------------------------------------------------------

@Schema({ collection: 'tableSessions', timestamps: true, autoIndex: true })
export class TableSession
  extends Document
  implements Omit<S.TableSession, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  tableId!: string;

  @Prop({ type: String, required: true })
  qrCodeId!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.TableSessionStatus),
    default: S.TableSessionStatus.OPEN,
  })
  status!: S.TableSessionStatus;

  @Prop({ type: Date, required: true, default: () => new Date() })
  openedAt!: Date;

  @Prop({ type: String })
  openedBy?: string;

  @Prop({ type: [String], required: true, default: [] })
  customerIds!: string[];

  @Prop({ type: [String], required: true, default: [] })
  orderIds!: string[];

  @Prop({ type: Number, required: true, default: 0 })
  totalAmount!: number;

  @Prop({ type: Number, required: true, default: 0 })
  paidAmount!: number;

  @Prop({ type: Number, required: true, default: 0 })
  balanceDue!: number;

  @Prop({ type: Date })
  closedAt?: Date;

  @Prop({ type: String })
  closedBy?: string;

  // Sub-documents: detailed order references with metadata
  @Prop({ type: [TableSessionOrderRefSchema], required: true, default: [] })
  orderRefs!: TableSessionOrderRef[];

  // Sub-documents: split payment groups for bill splitting
  @Prop({ type: [SplitGroupSchema], required: true, default: [] })
  splitGroups!: SplitGroup[];
}

export const TableSessionSchema = SchemaFactory.createForClass(TableSession);

// Partial unique index: ensure only one ACTIVE session per table at a time.
// A table can only have one session in OPEN / AWAITING_PAYMENT / PARTIALLY_PAID state.
// PAID and CLOSED sessions do not participate in this uniqueness constraint.
TableSessionSchema.index(
  { tableId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          S.TableSessionStatus.OPEN,
          S.TableSessionStatus.AWAITING_PAYMENT,
          S.TableSessionStatus.PARTIALLY_PAID,
        ],
      },
    },
  }
);

// Standard lookup indexes matching docs/03-mongodb-schema.md
TableSessionSchema.index({ branchId: 1, status: 1, openedAt: -1 });
TableSessionSchema.index({ tableId: 1, status: 1 });
TableSessionSchema.index({ qrCodeId: 1, status: 1 });
