import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Sub-document: PurchaseOrderItem (embedded in PurchaseOrder.items[])
// Single line item on a purchase order
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class PurchaseOrderItem extends Document {
  @Prop({ type: String, required: true })
  inventoryItemId!: string;

  // Snapshot of item name at time of PO (for audit even if item renamed)
  @Prop({ type: String })
  name?: string;

  @Prop({ type: String, enum: Object.values(S.Unit) })
  unit?: S.Unit;

  @Prop({ type: Number, required: true })
  quantityOrdered!: number;

  @Prop({ type: Number, required: true })
  unitCostCents!: number;

  // Quantity actually received — filled at GRN time
  @Prop({ type: Number })
  quantityReceived?: number;

  // Computed: quantityOrdered * unitCostCents
  @Prop({ type: Number })
  subtotalCents?: number;
}

export const PurchaseOrderItemSchema =
  SchemaFactory.createForClass(PurchaseOrderItem);

// ---------------------------------------------------------------------------
// Main document: PurchaseOrder
// ---------------------------------------------------------------------------

@Schema({ collection: 'purchaseOrders', timestamps: true, autoIndex: true })
export class PurchaseOrder
  extends Document
  implements
    Omit<
      S.PurchaseOrder,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'orderNumber'
      | 'subtotal'
      | 'taxAmount'
      | 'totalAmount'
      | 'expectedDate'
      | 'createdBy'
      | 'approvedBy'
      | 'items'
    >
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  // Human-readable PO number — unique per branch
  @Prop({ type: String })
  poNumber!: string;

  @Prop({ type: String, required: true, index: true })
  supplierId!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.PurchaseOrderStatus),
    default: S.PurchaseOrderStatus.DRAFT,
  })
  status!: S.PurchaseOrderStatus;

  @Prop({ type: String })
  orderedById?: string;

  @Prop({ type: Date })
  orderedAt?: Date;

  @Prop({ type: Date })
  expectedDeliveryDate?: Date;

  @Prop({ type: String })
  receivedById?: string;

  @Prop({ type: Date })
  receivedAt?: Date;

  @Prop({ type: String })
  notes?: string;

  // Embedded line items
  @Prop({ type: [PurchaseOrderItemSchema], required: true, default: [] })
  items!: PurchaseOrderItem[];

  // ---- Totals (all integer cents) -----------------------------------------

  @Prop({ type: Number })
  subtotalCents?: number;

  @Prop({ type: Number })
  taxCents?: number;

  @Prop({ type: Number })
  discountCents?: number;

  @Prop({ type: Number })
  totalCents?: number;
}

export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);

// Unique compound: PO numbers reset per branch
PurchaseOrderSchema.index(
  { branchId: 1, poNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { poNumber: { $exists: true, $ne: null } },
  }
);

// Recent POs per branch
PurchaseOrderSchema.index({ branchId: 1, createdAt: -1 });

// Supplier + status listing (e.g. "open POs with Supplier X")
PurchaseOrderSchema.index({ supplierId: 1, status: 1, createdAt: -1 });
