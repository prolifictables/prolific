import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline enum values for ShiftStatus — user spec uses OPEN/CLOSED/RECONCILED
// (S.ShiftStatus has OPEN/CLOSED/MISMATCH; RECONCILED added per requirement)
// ---------------------------------------------------------------------------

const ShiftStatus = [
  'OPEN',
  'CLOSED',
  'RECONCILED',
] as const;

// ---------------------------------------------------------------------------
// Main document: Shift
// Represents a cashier/work shift on a specific POS device with opening/closing
// cash drawer reconciliation and payment summary aggregates
// ---------------------------------------------------------------------------

@Schema({ collection: 'shifts', timestamps: true, autoIndex: true })
export class Shift extends Document {
  // Tenant / location identifiers
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  // Who and where this shift is running
  @Prop({ type: String, required: true, index: true })
  employeeId!: string;

  @Prop({ type: String, required: true, index: true })
  deviceId!: string;

  // Optional human-readable shift identifier (e.g. "Shift 42")
  @Prop({ type: String })
  shiftNumber?: string;

  // Shift timeline
  @Prop({ type: Date, required: true })
  openingTimestamp!: Date;

  @Prop({ type: Date })
  closingTimestamp?: Date;

  // Shift lifecycle status (OPEN / CLOSED / RECONCILED)
  @Prop({
    type: String,
    required: true,
    enum: ShiftStatus,
    default: 'OPEN',
  })
  status!: 'OPEN' | 'CLOSED' | 'RECONCILED';

  // ---- Cash drawer money fields (all integer cents) ----------------------

  // Opening float at the start of the shift (required)
  @Prop({ type: Number, required: true })
  openingCash!: number;

  // Cash counted by cashier at end of shift
  @Prop({ type: Number })
  closingCash?: number;

  // Expected vs actual payment breakdowns for reconciliation
  @Prop({ type: Number })
  cashPaymentsExpected?: number;

  @Prop({ type: Number })
  cashPaymentsActual?: number;

  @Prop({ type: Number })
  cardPaymentsExpected?: number;

  @Prop({ type: Number })
  cardPaymentsActual?: number;

  @Prop({ type: Number })
  otherPaymentsExpected?: number;

  @Prop({ type: Number })
  otherPaymentsActual?: number;

  // Totals across all payment methods
  @Prop({ type: Number })
  totalExpected?: number;

  @Prop({ type: Number })
  totalActual?: number;

  // Reconciliation variance: actual - expected (negative = short)
  @Prop({ type: Number })
  overShortCents?: number;

  // Free-form notes entered at shift close
  @Prop({ type: String })
  closingNotes?: string;

  // Audit: who/what closed the shift
  @Prop({ type: String })
  closedById?: string;

  @Prop({ type: String })
  closedByDeviceId?: string;

  // Detailed breakdown of physical cash denominations counted at close
  // Example: { "10000": 2, "5000": 5, "1000": 10, ... } (currency-unit: count)
  @Prop({ type: Object, default: undefined })
  cashDrawerSummary?: Record<string, unknown>;

  // Last time this record was pushed from POS to server (sync meta)
  @Prop({ type: Date })
  lastSyncAt?: Date;
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Critical business rule: only ONE open shift per device at any time
ShiftSchema.index(
  { deviceId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'OPEN' },
  }
);

// Fast lookup: recent shifts for an employee
ShiftSchema.index({ employeeId: 1, openingTimestamp: -1 });

// Fast lookup: recent shifts for a branch
ShiftSchema.index({ branchId: 1, openingTimestamp: -1 });
