import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Sub-document: KitchenOrderItem (embedded in KitchenOrder.items[])
// A single menu item line as displayed on the kitchen display system
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class KitchenOrderItem extends Document {
  @Prop({ type: String, required: true })
  orderItemId!: string;

  @Prop({ type: String, required: true })
  menuItemId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Number, required: true })
  quantity!: number;

  @Prop({ type: String })
  notes?: string;

  // Human-readable summary of modifier selections (e.g. "Medium, Extra cheese")
  @Prop({ type: String })
  modifierSummary?: string;

  @Prop({
    type: String,
    enum: Object.values(S.KitchenStatus),
    default: S.KitchenStatus.NEW,
  })
  status?: S.KitchenStatus;
}

export const KitchenOrderItemSchema =
  SchemaFactory.createForClass(KitchenOrderItem);

// ---------------------------------------------------------------------------
// Main document: KitchenOrder
// Groups one or more order items for a specific kitchen station / priority
// ---------------------------------------------------------------------------

// Inline enum values: LOW / NORMAL / HIGH / URGENT (not currently in S)
const KitchenOrderPriority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

// Inline enum values: KitchenOrderStatus (matches S.KitchenStatus values)
const KitchenOrderStatus = Object.values(S.KitchenStatus);

@Schema({ collection: 'kitchenOrders', timestamps: true, autoIndex: true })
export class KitchenOrder
  extends Document
  implements
    Omit<
      S.KitchenOrder,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'stationId'
      | 'assignedCookId'
      | 'startedAt'
      | 'priority'
    >
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  orderId!: string;

  @Prop({ type: String, required: true })
  orderNumber!: string;

  @Prop({ type: String })
  tableId?: string;

  @Prop({ type: String })
  tableNumber?: string;

  @Prop({ type: String })
  customerName?: string;

  // LOW / NORMAL / HIGH / URGENT
  @Prop({
    type: String,
    required: true,
    enum: KitchenOrderPriority,
    default: 'NORMAL',
  })
  priority!: string;

  // NEW / PREPARING / READY / COMPLETED / CANCELLED (using S.KitchenStatus)
  @Prop({
    type: String,
    required: true,
    enum: KitchenOrderStatus,
    default: S.KitchenStatus.NEW,
  })
  status!: S.KitchenStatus;

  @Prop({ type: String })
  station?: string;

  @Prop({ type: String })
  assignedToEmployeeId?: string;

  // Embedded line items for this kitchen ticket
  @Prop({
    type: [KitchenOrderItemSchema],
    required: true,
    default: [],
  })
  items!: KitchenOrderItem[];

  @Prop({ type: Date, required: true, default: () => new Date() })
  orderPlacedAt!: Date;

  @Prop({ type: Date })
  preparationStartedAt?: Date;

  @Prop({ type: Date })
  readyAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  // Which KDS device/tab this ticket is assigned to
  @Prop({ type: String })
  kdsDisplayId?: string;

  @Prop({ type: String })
  notes?: string;

  // References back to parent order's orderItem ids (subset)
  @Prop({ type: [String], required: true, default: [] })
  orderItemIds!: string[];
}

export const KitchenOrderSchema =
  SchemaFactory.createForClass(KitchenOrder);

// Primary KDS view: filter by branch + status, sort by priority then newest
KitchenOrderSchema.index({
  branchId: 1,
  status: 1,
  priority: 1,
  orderPlacedAt: -1,
});

// Per-station KDS view
KitchenOrderSchema.index({ station: 1, status: 1, orderPlacedAt: -1 });

// Sparse unique back-reference: 1 order → at most 1 kitchenOrder (for simple
// Phase 1 setup; Phase 2 will allow multiple kitchen orders per order split by
// station, so this will become a non-unique index).
KitchenOrderSchema.index({ orderId: 1 }, { unique: true, sparse: true });
