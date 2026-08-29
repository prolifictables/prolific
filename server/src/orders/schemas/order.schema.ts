import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Sub-sub-document: ModifierOption within an OrderItem
// Captures the specific modifier+option selections at time of order
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class OrderItemModifierOption extends Document {
  @Prop({ type: String, required: true })
  modifierId!: string;

  @Prop({ type: String, required: true })
  optionId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: Number, required: true, default: 0 })
  priceDeltaCents!: number;
}

export const OrderItemModifierOptionSchema =
  SchemaFactory.createForClass(OrderItemModifierOption);

// ---------------------------------------------------------------------------
// Sub-document: OrderItem (embedded in Order.items[])
// Immutable snapshot of a single line item on the order
// ---------------------------------------------------------------------------

@Schema({ _id: false })
export class OrderItem extends Document {
  @Prop({ type: String, required: true })
  menuItemId!: string;

  @Prop({ type: String, required: true })
  menuItemName!: string;

  // Archival copy of the full menu item at time of order (Mixed/any shape)
  @Prop({ type: Object, default: undefined })
  menuItemSnapshot?: Record<string, unknown>;

  @Prop({ type: Number, required: true })
  quantity!: number;

  @Prop({ type: Number, required: true })
  unitPriceCents!: number;

  @Prop({ type: Number, required: true })
  subtotalCents!: number;

  // Sub-sub-doc: selected modifier options for this line item
  @Prop({
    type: [OrderItemModifierOptionSchema],
    required: true,
    default: [],
  })
  modifierOptions!: OrderItemModifierOption[];

  @Prop({ type: Number, required: true, default: 0 })
  discountCents!: number;

  @Prop({ type: Number, required: true, default: 0 })
  taxCents!: number;

  @Prop({ type: Number, required: true })
  totalCents!: number;

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: Boolean, required: true, default: false })
  isVoided!: boolean;

  @Prop({
    type: String,
    enum: Object.values(S.KitchenStatus),
    default: S.KitchenStatus.NEW,
  })
  preparationStatus?: S.KitchenStatus;

  @Prop({ type: String })
  assignedKitchenStation?: string;

  @Prop({ type: Date })
  printedAt?: Date;

  @Prop({ type: String })
  kitchenNotes?: string;

  @Prop({ type: Date })
  madeAt?: Date;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

// ---------------------------------------------------------------------------
// Main document: Order
// ---------------------------------------------------------------------------

@Schema({ collection: 'orders', timestamps: true, autoIndex: true })
export class Order
  extends Document
  implements
    Omit<
      S.Order,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'orderType'
      | 'sourceChannel'
      | 'subtotal'
      | 'discountAmount'
      | 'taxAmount'
      | 'totalAmount'
      | 'paidAmount'
      | 'balanceDue'
      | 'tipAmount'
      | 'customerName'
      | 'customerPhone'
      | 'tableName'
      | 'deviceId'
      | 'items'
      | 'discountId'
    >
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  // Human-readable order number — forms unique compound with branchId
  @Prop({ type: String, required: true })
  orderNumber!: string;

  // DINE_IN / TAKEAWAY / PICKUP / DELIVERY (plus QR_ORDER, ONLINE from S)
  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.OrderType),
  })
  type!: S.OrderType;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.OrderStatus),
    default: S.OrderStatus.PENDING,
  })
  status!: S.OrderStatus;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.PaymentStatus),
    default: S.PaymentStatus.UNPAID,
  })
  paymentStatus!: S.PaymentStatus;

  // POS | QR | WEBSITE | APP | PHONE (using inline values since S uses sourceChannel)
  @Prop({
    type: String,
    required: true,
    enum: ['POS', 'QR', 'WEBSITE', 'APP', 'PHONE'],
  })
  source!: string;

  @Prop({ type: String })
  tableId?: string;

  @Prop({ type: String })
  tableSessionId?: string;

  @Prop({ type: String })
  qrCodeId?: string;

  @Prop({ type: String })
  customerId?: string;

  @Prop({ type: String })
  customerSessionId?: string;

  @Prop({ type: String })
  employeeId?: string;

  @Prop({ type: String })
  shiftId?: string;

  // ---- Money fields (all integer cents) -----------------------------------

  @Prop({ type: Number, required: true })
  subtotalCents!: number;

  @Prop({ type: Number, required: true, default: 0 })
  discountCents!: number;

  @Prop({ type: Number, required: true, default: 0 })
  taxCents!: number;

  @Prop({ type: Number, required: true })
  totalCents!: number;

  // -------------------------------------------------------------------------

  @Prop({ type: String })
  discountId?: string;

  @Prop({ type: [String], required: true, default: [] })
  taxIds!: string[];

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: String })
  voidReason?: string;

  @Prop({ type: String })
  refundReason?: string;

  // Employee who currently holds this order (on-hold)
  @Prop({ type: String })
  heldBy?: string;

  @Prop({ type: Date })
  heldAt?: Date;

  // GLOBALLY unique — prevents duplicate order creation during sync retries
  @Prop({ type: String, required: true })
  idempotencyKey!: string;

  // Sync version tracking
  @Prop({ type: Number })
  serverOrderVersion?: number;

  @Prop({ type: Number })
  cloudVersion?: number;

  // Status timestamps
  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  voidedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  // Embedded line items
  @Prop({ type: [OrderItemSchema], required: true, default: [] })
  items!: OrderItem[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Unique compound index: order numbers reset per branch
OrderSchema.index({ branchId: 1, orderNumber: 1 }, { unique: true });

// Standard list / filter indexes as specified
OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tableSessionId: 1, status: 1 });
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ shiftId: 1, paymentStatus: 1 });

// Critical global uniqueness — prevents duplicate processing during sync
OrderSchema.index({ idempotencyKey: 1 }, { unique: true });

// Source-channel based lookups (e.g., all web orders this week)
OrderSchema.index({ source: 1, createdAt: -1 });
