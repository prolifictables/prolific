import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// InventoryItem — stock-keeping unit tracked per branch
// ---------------------------------------------------------------------------

@Schema({ collection: 'inventoryItems', timestamps: true, autoIndex: true })
export class InventoryItem
  extends Document
  implements
    Omit<
      S.InventoryItem,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'currentStock'
      | 'minimumStock'
      | 'optimalStock'
      | 'costPrice'
      | 'supplierId'
      | 'lastRestockedAt'
    >
{
  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  // Unique compound per branch — same SKU cannot exist twice in one branch
  @Prop({ type: String, sparse: true })
  sku!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: String, index: true })
  category?: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(S.Unit),
  })
  unit!: S.Unit;

  // Current stock on hand (decimal for fractional units like KG, L)
  @Prop({ type: Number, required: true })
  currentStockLevel!: number;

  // Alert-triggering floor (default 0)
  @Prop({ type: Number, default: 0 })
  minimumStockLevel?: number;

  // When stock drops below this level, system suggests reordering
  @Prop({ type: Number })
  reorderLevel?: number;

  // How many units to reorder when below reorderLevel
  @Prop({ type: Number })
  reorderQuantity?: number;

  // Last known unit purchase price (INTEGER cents)
  @Prop({ type: Number, required: true })
  unitCostCents!: number;

  // Default markup percentage applied on top of unitCostCents
  @Prop({ type: Number })
  defaultMarkupPercent?: number;

  @Prop({ type: String, index: true })
  preferredSupplierId?: string;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: Date })
  lastCountedAt?: Date;

  // Free-text storage location (walk-in freezer, shelf A3, etc.
  @Prop({ type: String })
  storageLocation?: string;

  // Barcode / GTIN (sparse, indexed for lookup by scanner)
  @Prop({ type: String, sparse: true, index: true })
  barCode?: string;
}

export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);

// Unique compound: SKUs must be unique within a branch (sparse — allow nulls
InventoryItemSchema.index(
  { branchId: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $exists: true, $ne: null } },
  }
);

// Compound index for typical list query: branch + active + category
InventoryItemSchema.index({ branchId: 1, isActive: 1, category: 1 });

// Partial low-stock query index — find items needing attention
InventoryItemSchema.index(
  { branchId: 1, currentStockLevel: 1, minimumStockLevel: 1, isActive: 1 },
  {
    partialFilterExpression: {
      isActive: true,
      $expr: { $lte: ['$currentStockLevel', '$minimumStockLevel'] },
    },
  }
);
