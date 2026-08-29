import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Inline enum values for user-specified setting enums (not present in S):
//   SettingValueType: STRING | NUMBER | BOOLEAN | OBJECT
//   SettingScope:     GLOBAL | RESTAURANT | BRANCH | DEVICE
// ---------------------------------------------------------------------------

const SettingValueType = ['STRING', 'NUMBER', 'BOOLEAN', 'OBJECT'] as const;

const SettingScope = [
  'GLOBAL',
  'RESTAURANT',
  'BRANCH',
  'DEVICE',
] as const;

// ---------------------------------------------------------------------------
// Main document: Setting
// Hierarchical key/value configuration store with 4 scope levels:
//   GLOBAL     → restaurantId = null, branchId = null   (system defaults)
//   RESTAURANT → restaurantId = X,    branchId = null   (restaurant-level)
//   BRANCH     → restaurantId = X,    branchId = Y      (branch-level)
//   DEVICE     → restaurantId = X,    branchId = Y, + deviceId implied in key
// Resolve logic walks from DEVICE → BRANCH → RESTAURANT → GLOBAL, picking the
// most specific non-null match for a key.
// ---------------------------------------------------------------------------

@Schema({ collection: 'settings', timestamps: true, autoIndex: true })
export class Setting
  extends Document
  implements
    Omit<
      S.BranchSettings,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'restaurantId'
      | 'branchId'
      | 'receiptHeader'
      | 'receiptFooter'
      | 'logoUrlForReceipt'
      | 'enableTips'
      | 'tipOptions'
      | 'defaultTaxRateId'
      | 'defaultServiceCharge'
      | 'autoPrintKitchenTickets'
      | 'autoPrintReceipts'
      | 'requireCustomerName'
      | 'requireManagerPinFor'
      | 'lowStockAlertThreshold'
    >
{
  // Nullable for global defaults; index allows efficient per-restaurant lookup
  @Prop({ type: String, index: true })
  restaurantId?: string | null;

  // Nullable for global / restaurant-level defaults; index for per-branch lookups
  @Prop({ type: String, index: true })
  branchId?: string | null;

  // Setting key in dot-notation form, e.g.
  //   "receipt.header" | "tax.defaultRate" | "kitchen.autoPrint" | "payment.enablePaystack"
  @Prop({ type: String, required: true })
  key!: string;

  // The actual value. Mixed type because a setting can be any JSON shape —
  // string, number, boolean, object, or nested JSON. ValueType below hints
  // at the expected primitive/complex type for validation on read/write.
  @Prop({ type: Object, default: undefined })
  value?: string | number | boolean | Record<string, unknown> | unknown[] | null;

  // Type hint for clients to correctly parse / validate the `value` blob
  @Prop({
    type: String,
    enum: SettingValueType,
    default: 'STRING',
  })
  valueType?: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT';

  // Which scope level this row lives at (determines which of restaurantId /
  // branchId fields are expected to be set or null)
  @Prop({
    type: String,
    required: true,
    enum: SettingScope,
  })
  scope!: 'GLOBAL' | 'RESTAURANT' | 'BRANCH' | 'DEVICE';

  // Audit: employeeId or "system" that last modified this row
  @Prop({ type: String })
  updatedBy?: string;

  // Human-readable description of what this setting controls (optional docs)
  @Prop({ type: String })
  description?: string;

  // Schema version — reserved for future migration of the value shape
  @Prop({ type: Number, required: true, default: 1 })
  schemaVersion!: number;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Unique compound key with partial filter allowing null fields.
// This guarantees there's at most one row per (restaurantId, branchId, key)
// at any scope level. Because partial indexes in MongoDB treat null as a value,
// we rely on the combination: each scope level stores the corresponding fields
// as null for higher-level rows, and this index enforces uniqueness across the
// (scope-aware) triplet.
SettingSchema.index(
  { restaurantId: 1, branchId: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      key: { $exists: true },
    },
  }
);
