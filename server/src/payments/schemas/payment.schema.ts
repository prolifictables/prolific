import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline enum values (user's explicit spec, which differs from S in places:
//   PaymentMethod:       CASH / CARD / BANK_TRANSFER / ONLINE_PAYSTACK /
//                        ONLINE_FLUTTERWAVE / EXTERNAL / OTHER
//   PaymentVerification: LOCAL / PROVIDER / NONE
//   PaymentStatus:       PENDING / COMPLETED / FAILED / REFUNDED
// ---------------------------------------------------------------------------

const PaymentMethod = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'ONLINE_PAYSTACK',
  'ONLINE_FLUTTERWAVE',
  'EXTERNAL',
  'OTHER',
] as const;

const PaymentVerification = ['LOCAL', 'PROVIDER', 'NONE'] as const;

// PaymentStatus: user wants PENDING/COMPLETED/FAILED/REFUNDED (subset of S.PaymentStatus)
// Using S.PaymentStatus enum directly since it contains these values

// ---------------------------------------------------------------------------
// Main document: Payment
// A single financial transaction against an order (1 order → N payments)
// ---------------------------------------------------------------------------

@Schema({ collection: 'payments', timestamps: true, autoIndex: true })
export class Payment
  extends Document
  implements
    Omit<
      S.Payment,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'method'
      | 'verificationType'
      | 'status'
      | 'amount'
      | 'providerTransactionId'
      | 'providerReference'
      | 'terminalId'
      | 'authorizationCode'
      | 'last4Digits'
      | 'cardBrand'
      | 'processedAt'
      | 'failedAt'
      | 'failureReason'
      | 'refundedAmount'
      | 'refundReference'
    >
{
  @Prop({ type: String, required: true })
  restaurantId!: string;

  @Prop({ type: String, required: true })
  branchId!: string;

  @Prop({ type: String, required: true })
  orderId!: string;

  @Prop({ type: String })
  tableSessionId?: string;

  @Prop({ type: String })
  customerId?: string;

  @Prop({ type: String })
  employeeId?: string;

  @Prop({ type: String })
  shiftId?: string;

  // ---- Money ---------------------------------------------------------------

  @Prop({ type: Number, required: true })
  amountCents!: number;

  @Prop({ type: String, required: true, default: 'USD' })
  currency!: string;

  // ---- Method & verification --------------------------------------------

  @Prop({ type: String, required: true, enum: PaymentMethod })
  method!: string;

  // How this payment was verified (or was not) verified
  @Prop({
    type: String,
    required: true,
    enum: PaymentVerification,
    default: 'NONE',
  })
  verificationSource!: string;

  @Prop({
    type: String, required: true, enum: Object.values(S.PaymentStatus) })
  status!: S.PaymentStatus;

  // ---- Online / provider- payment fields ---------------------------------

  // Merchant-facing reference (e.g. Paystack reference)
  @Prop({ type: String })
  transactionReference?: string;

  // Provider short name, e.g. "paystack", "flutterwave", "pos_card"
  @Prop({ type: String })
  provider?: string;

  @Prop({ type: String })
  providerPaymentId?: string;

  // Raw provider response snapshot for debugging / reconciliation
  @Prop({ type: Object, default: undefined })
  providerResponse?: Record<string, unknown>;

  // ---- Split payment fields ---------------------------------------------

  @Prop({ type: Boolean, required: true, default: false })
  isSplitPayment!: boolean;

  @Prop({ type: String })
  splitGroupId?: string;

  // ---- Customer / receipt fields ---------------------------------------

  @Prop({ type: String })
  paidByCustomerName?: string;

  @Prop({ type: String })
  paidByPhone?: string;

  @Prop({ type: String })
  receiptNumber?: string;

  @Prop({ type: Date })
  receiptPrintedAt?: Date;

  // ---- Misc / audit ------------------------------------------------------

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: String })
  refundReason?: string;

  @Prop({ type: String })
  refundedById?: string;

  @Prop({ type: Date })
  refundedAt?: Date;

  // Idempotency — globally unique, prevents duplicate payment recording
  @Prop({ type: String, required: true })
  idempotencyKey!: string;

  // Status timestamps
  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  failedAt?: Date;

  // POS device that recorded the payment
  @Prop({ type: String })
  deviceId?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// --- Indexes ----------------------------------------------------------

// Look up all payments (or pending ones) for a given order
PaymentSchema.index({ orderId: 1, status: 1 });

// Daily / shift-based reconciliation views by branch
PaymentSchema.index({ branchId: 1, completedAt: -1 });

// Shift closeout: all payments per shift by status
PaymentSchema.index({ shiftId: 1, status: 1 });

// Global duplicate-prevention index
PaymentSchema.index({ idempotencyKey: 1 }, { unique: true });

// Per-method sales reports for a branch over a date range
PaymentSchema.index({ method: 1, branchId: 1, completedAt: -1 });

// Provider idempotency: a given provider reference + provider combo is unique
// when it exists (sparse — most payments won't have a provider reference)
PaymentSchema.index(
  { transactionReference: 1, provider: 1 },
  { unique: true, sparse: true }
);
