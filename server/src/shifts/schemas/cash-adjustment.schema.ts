import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline CashAdjustmentType using AuditAction CASH_PAYIN / CASH_PAYOUT values
// (S.AuditAction already defines these)
// ---------------------------------------------------------------------------

const CashAdjustmentType = [
  S.AuditAction.CASH_PAYIN,
  S.AuditAction.CASH_PAYOUT,
] as const;

// ---------------------------------------------------------------------------
// Main document: CashAdjustment
// Records any money added to (PAYIN) or removed from (PAYOUT) the cash drawer
// outside of normal order payments — e.g. petty cash, till top-up, vendor payout
// ---------------------------------------------------------------------------

@Schema({ collection: 'cashAdjustments', timestamps: false, autoIndex: true })
export class CashAdjustment extends Document {
  // Location identifier (shift implicitly links to restaurant via shift→branch)
  @Prop({ type: String, required: true })
  branchId!: string;

  // Foreign key → shift this adjustment belongs to
  @Prop({ type: String })
  shiftId?: string;

  // Employee who recorded the adjustment
  @Prop({ type: String })
  employeeId?: string;

  // Which POS device recorded it
  @Prop({ type: String })
  deviceId?: string;

  // CASH_PAYIN (add to drawer) or CASH_PAYOUT (remove from drawer)
  @Prop({
    type: String,
    required: true,
    enum: CashAdjustmentType,
  })
  type!: S.AuditAction.CASH_PAYIN | S.AuditAction.CASH_PAYOUT;

  // Amount in integer cents (always positive; type determines direction)
  @Prop({ type: Number, required: true })
  amountCents!: number;

  // Short required reason code or description
  @Prop({ type: String, required: true })
  reason!: string;

  // Additional free-form notes
  @Prop({ type: String })
  notes?: string;

  // Employee who recorded / approved the entry
  @Prop({ type: String })
  recordedById?: string;

  // Created timestamp (not using Mongoose timestamps — we manage it explicitly
  // because S.CashAdjustment uses createdAt only, no updatedAt)
  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;
}

export const CashAdjustmentSchema =
  SchemaFactory.createForClass(CashAdjustment);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Chronological adjustments within a single shift (most common query at close)
CashAdjustmentSchema.index({ shiftId: 1, createdAt: -1 });

// Branch-level adjustment reporting / audit over a date range
CashAdjustmentSchema.index({ branchId: 1, createdAt: -1 });
