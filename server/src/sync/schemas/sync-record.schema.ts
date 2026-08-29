import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline enum values for user-specified sync types that differ from S:
//   SyncOperation:    CREATE | UPDATE | DELETE
//   SyncStatus:       PENDING | SUCCESS | CONFLICT | FAILED | RETRYING
//   ConflictResolution: SERVER_WINS | CLIENT_WINS | MERGED | UNRESOLVED
// ---------------------------------------------------------------------------

const SyncOperation = ['CREATE', 'UPDATE', 'DELETE'] as const;

const SyncStatus = [
  'PENDING',
  'SUCCESS',
  'CONFLICT',
  'FAILED',
  'RETRYING',
] as const;

const ConflictResolution = [
  'SERVER_WINS',
  'CLIENT_WINS',
  'MERGED',
  'UNRESOLVED',
] as const;

// Allowed entity types for sync records (union of S.SyncEntityType values
// plus the additional types the user specified: REFUND, VOID, CUSTOMER,
// KITCHEN_STATUS, etc.)
const EntityType = [
  ...Object.values(S.SyncEntityType),
  'REFUND',
  'VOID',
  'CUSTOMER',
  'KITCHEN_STATUS',
] as const;

// ---------------------------------------------------------------------------
// Main document: SyncRecord
// Audit-trail + retry queue entry for every entity that went (or needs to go)
// through the POS ↔ server sync pipeline. Idempotency key prevents double-apply
// even when the same payload is retried over an unreliable network.
// ---------------------------------------------------------------------------

@Schema({ collection: 'syncRecords', timestamps: true, autoIndex: true })
export class SyncRecord extends Document {
  // Device that initiated / owns this sync attempt
  @Prop({ type: String, required: true, index: true })
  deviceId!: string;

  // Branch context — used for broad branch-level queries / reporting
  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  // Per-device idempotency key — together with deviceId this is the global
  // uniqueness guarantee that prevents double processing of retried commands
  @Prop({ type: String, required: true })
  idempotencyKey!: string;

  // Which entity kind this record is about (ORDER, PAYMENT, ...)
  @Prop({
    type: String,
    required: true,
    enum: EntityType,
    index: true,
  })
  entityType!: string;

  // Primary id of the entity on whichever side originated it
  @Prop({ type: String, required: true, index: true })
  entityId!: string;

  // CREATE / UPDATE / DELETE
  @Prop({ type: String, enum: SyncOperation })
  operation?: 'CREATE' | 'UPDATE' | 'DELETE';

  // Lifecycle status of this sync attempt
  @Prop({
    type: String,
    required: true,
    enum: SyncStatus,
    default: 'PENDING',
    index: true,
  })
  status!: 'PENDING' | 'SUCCESS' | 'CONFLICT' | 'FAILED' | 'RETRYING';

  // When the record was successfully applied on the server
  @Prop({ type: Date, index: true })
  appliedAt?: Date;

  // Monotonic version counters for optimistic conflict detection
  @Prop({ type: Number })
  serverEntityVersion?: number;

  @Prop({ type: Number })
  localEntityVersion?: number;

  // Retry bookkeeping
  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  @Prop({ type: Date })
  lastAttemptAt?: Date;

  // Last error message (from the most recent failed attempt)
  @Prop({ type: String })
  lastError?: string;

  // How a conflict was (or should be) resolved
  @Prop({ type: String, enum: ConflictResolution })
  conflictResolution?: 'SERVER_WINS' | 'CLIENT_WINS' | 'MERGED' | 'UNRESOLVED';

  // Full command payload snapshot — allows replay / audit of exactly what
  // the POS sent for this attempt
  @Prop({ type: Object, default: undefined })
  rawPayload?: Record<string, unknown>;

  // Snapshot of the server-side response / applied result for debugging
  @Prop({ type: Object, default: undefined })
  responseSnapshot?: Record<string, unknown>;
}

export const SyncRecordSchema = SchemaFactory.createForClass(SyncRecord);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Global uniqueness: the same device cannot process the same idempotency key
// twice, ever — this is the strongest correctness guarantee for sync
SyncRecordSchema.index(
  { deviceId: 1, idempotencyKey: 1 },
  { unique: true }
);

// Worker pickup: find pending / retrying items for a given device filtered
// by entity type (sync workers often process one entity kind at a time)
SyncRecordSchema.index({ deviceId: 1, status: 1, entityType: 1 });

// Branch-level historical reporting: all successfully applied operations
// in a branch over a date window
SyncRecordSchema.index({ branchId: 1, appliedAt: -1 });
