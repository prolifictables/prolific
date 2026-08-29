import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// InventoryTransaction — append-only ledger entry
// Each mutation to inventory stock levels produces a row here
// ---------------------------------------------------------------------------

@Schema({ collection: 'inventoryTransactions', timestamps: true, autoIndex: true })
export class InventoryTransaction
  extends Document
  implements
    Omit<
      S.InventoryTransaction,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'quantity'
      | 'unitCost'
      | 'totalCost'
      | 'employeeId'
      | 'referenceType'
    >
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true, index: true })
  inventoryItemId!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.InventoryTransactionType),
  })
  type!: S.InventoryTransactionType;

  // Positive = stock increase, Negative = stock decrease
  @Prop({ type: Number, required: true })
  quantityChange!: number;

  // Snapshot of unit cost at time of transaction (cents)
  @Prop({ type: Number })
  unitCostCentsAtTime?: number;

  // What kind of entity produced this tx
  @Prop({
    type: String,
    enum: [
      'ORDER',
      'PURCHASE_ORDER',
      'WASTAGE_REPORT',
      'COUNT',
      'ADJUSTMENT',
      'RECIPE_DEDUCTION',
    ],
  })
  referenceType?: string;

  @Prop({ type: String, index: true })
  referenceId?: string;

  // Human-readable reason / notes
  @Prop({ type: String })
  reason?: string;

  // Employee / user who performed the action
  @Prop({ type: String })
  performedById?: string;

  // When the action actually happened (can differ from createdAt for backdated counts
  @Prop({ type: Date, required: true, default: Date.now })
  performedAt!: Date;

  @Prop({ type: String })
  supplierId?: string;

  // Shift context (for POS-originated adjustments)
  @Prop({ type: String })
  shiftId?: string;
}

export const InventoryTransactionSchema = SchemaFactory.createForClass(
  InventoryTransaction
);

// Item-level audit trail: list transactions for one item, newest first
InventoryTransactionSchema.index({ inventoryItemId: 1, performedAt: -1 });

// Branch-level filtering by transaction type (e.g. all WASTAGE this month)
InventoryTransactionSchema.index({ branchId: 1, type: 1, performedAt: -1 });

// Reference lookup: find txs tied to a specific PO / order / report
InventoryTransactionSchema.index({ referenceType: 1, referenceId: 1 });
