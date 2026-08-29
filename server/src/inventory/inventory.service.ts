import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { InventoryItem } from './schemas/inventory-item.schema';
import { InventoryTransaction } from './schemas/inventory-transaction.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface CreateInventoryItemInput {
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unit: S.Unit;
  currentStockLevel: number;
  minimumStockLevel?: number;
  reorderLevel?: number;
  reorderQuantity?: number;
  unitCostCents: number;
  defaultMarkupPercent?: number;
  preferredSupplierId?: string;
  storageLocation?: string;
  barCode?: string;
}

export interface UpdateStockLevelInput {
  quantityChange: number;
  type?: S.InventoryTransactionType;
  reason?: string;
  supplierId?: string;
  shiftId?: string;
  referenceId?: string;
  referenceType?: string;
}

export interface ListInventoryItemsFilters {
  lowStockOnly?: boolean;
  supplierId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
  };
}

export interface ListStockHistoryFilters {
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectModel(InventoryItem.name)
    private readonly inventoryItemModel: Model<InventoryItem>,
    @InjectModel(InventoryTransaction.name)
    private readonly inventoryTransactionModel: Model<InventoryTransaction>
  ) {}

  async listInventoryItems(
    ctx: AuthContext,
    filters: ListInventoryItemsFilters = {}
  ): Promise<PaginatedResult<InventoryItem>> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId, isActive: true };

    if (filters.lowStockOnly) {
      query.$expr = { $lte: ['$currentStockLevel', '$minimumStockLevel'] };
    }
    if (filters.supplierId) {
      (query as any).preferredSupplierId = filters.supplierId;
    }
    if (filters.q) {
      (query as any).$or = [
        { name: { $regex: filters.q, $options: 'i' } },
        { sku: { $regex: filters.q, $options: 'i' } },
      ];
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id) {
          query._id = { $lt: new Types.ObjectId(parsed._id) };
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.inventoryItemModel
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      cursor = Buffer.from(
        JSON.stringify({ _id: last._id.toString() })
      ).toString('base64');
    }

    return { data, meta: { cursor, count, hasMore } };
  }

  async createItem(
    ctx: AuthContext,
    input: CreateInventoryItemInput
  ): Promise<InventoryItem> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestException('Item name is required');
    }
    if (input.unitCostCents === undefined || input.unitCostCents < 0) {
      throw new BadRequestException('Unit cost must be >= 0');
    }
    if (input.currentStockLevel === undefined || input.currentStockLevel < 0) {
      throw new BadRequestException('Current stock must be >= 0');
    }

    const item = await this.inventoryItemModel.create({
      restaurantId,
      branchId,
      sku: input.sku,
      name: input.name,
      description: input.description,
      category: input.category,
      unit: input.unit,
      currentStockLevel: input.currentStockLevel,
      minimumStockLevel: input.minimumStockLevel ?? 0,
      reorderLevel: input.reorderLevel,
      reorderQuantity: input.reorderQuantity,
      unitCostCents: input.unitCostCents,
      defaultMarkupPercent: input.defaultMarkupPercent,
      preferredSupplierId: input.preferredSupplierId,
      isActive: true,
      storageLocation: input.storageLocation,
      barCode: input.barCode,
    });

    if (input.currentStockLevel > 0) {
      await this.inventoryTransactionModel.create({
        restaurantId,
        branchId,
        inventoryItemId: item._id.toString(),
        type: S.InventoryTransactionType.PURCHASE,
        quantityChange: input.currentStockLevel,
        unitCostCentsAtTime: input.unitCostCents,
        referenceType: 'ADJUSTMENT',
        reason: 'Initial stock setup',
        performedById: ctx.employeeId ?? ctx.userId,
        performedAt: new Date(),
      });
    }

    return item;
  }

  async updateStockLevel(
    ctx: AuthContext,
    itemId: string,
    input: UpdateStockLevelInput
  ): Promise<InventoryItem> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const item = await this.inventoryItemModel
      .findOne({ _id: itemId, branchId })
      .exec();
    if (!item) {
      throw new NotFoundException(`InventoryItem ${itemId} not found`);
    }

    if (input.quantityChange === undefined || input.quantityChange === 0) {
      throw new BadRequestException('Quantity change must be non-zero');
    }

    const txType = input.type ?? S.InventoryTransactionType.ADJUSTMENT;

    await this.inventoryTransactionModel.create({
      restaurantId,
      branchId,
      inventoryItemId: itemId,
      type: txType,
      quantityChange: input.quantityChange,
      unitCostCentsAtTime: item.unitCostCents,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      supplierId: input.supplierId,
      performedById: ctx.employeeId ?? ctx.userId,
      performedAt: new Date(),
      shiftId: input.shiftId,
    });

    const updated = await this.inventoryItemModel
      .findByIdAndUpdate(
        item._id,
        {
          $inc: { currentStockLevel: input.quantityChange },
          $set: { lastCountedAt: new Date() },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('InventoryItem disappeared');
    return updated;
  }

  async recordWastage(
    ctx: AuthContext,
    itemId: string,
    quantity: number,
    reason?: string
  ): Promise<InventoryItem> {
    if (quantity <= 0) {
      throw new BadRequestException('Wastage quantity must be > 0');
    }
    return this.updateStockLevel(ctx, itemId, {
      quantityChange: -quantity,
      type: S.InventoryTransactionType.WASTAGE,
      reason,
    });
  }

  async recordAdjustment(
    ctx: AuthContext,
    itemId: string,
    newQuantity: number,
    reason?: string
  ): Promise<InventoryItem> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const item = await this.inventoryItemModel
      .findOne({ _id: itemId, branchId })
      .exec();
    if (!item) {
      throw new NotFoundException(`InventoryItem ${itemId} not found`);
    }

    if (newQuantity < 0) {
      throw new BadRequestException('New quantity must be >= 0');
    }

    const delta = newQuantity - item.currentStockLevel;
    if (delta === 0) {
      return item;
    }

    return this.updateStockLevel(ctx, itemId, {
      quantityChange: delta,
      type: S.InventoryTransactionType.ADJUSTMENT,
      reason: reason ?? `Count adjustment: ${item.currentStockLevel} → ${newQuantity}`,
    });
  }

  async listStockHistory(
    ctx: AuthContext,
    itemId: string,
    filters: ListStockHistoryFilters = {}
  ): Promise<PaginatedResult<InventoryTransaction>> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const item = await this.inventoryItemModel
      .findOne({ _id: itemId, branchId })
      .exec();
    if (!item) {
      throw new NotFoundException(`InventoryItem ${itemId} not found`);
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { inventoryItemId: itemId, branchId };

    if (filters.from || filters.to) {
      query.performedAt = {} as Record<string, Date>;
      if (filters.from) {
        (query.performedAt as Record<string, Date>).$gte = filters.from;
      }
      if (filters.to) {
        (query.performedAt as Record<string, Date>).$lte = filters.to;
      }
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id && parsed.performedAt) {
          query.$or = [
            { performedAt: { $lt: new Date(parsed.performedAt) } },
            {
              performedAt: { $eq: new Date(parsed.performedAt) },
              _id: { $lt: new Types.ObjectId(parsed._id) },
            },
          ];
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.inventoryTransactionModel
      .find(query)
      .sort({ performedAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1] as unknown as {
        _id: Types.ObjectId;
        performedAt: Date;
      };
      cursor = Buffer.from(
        JSON.stringify({
          _id: last._id.toString(),
          performedAt: last.performedAt.toISOString(),
        })
      ).toString('base64');
    }

    return { data, meta: { cursor, count, hasMore } };
  }
}
