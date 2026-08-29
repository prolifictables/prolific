import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { Discount } from './schemas/discount.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface ListDiscountsFilters {
  isActive?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateDiscountInput {
  name: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  maxAmount?: number;
  minOrderAmount?: number;
  isActive?: boolean;
  requiresManagerApproval?: boolean;
  approvalThreshold?: number;
}

export interface UpdateDiscountInput extends Partial<CreateDiscountInput> {}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
  };
}

function withVirtualId(doc: any): any {
  const obj = doc?.toObject ? doc.toObject() : doc;
  if (!obj) return obj;
  return { ...obj, id: obj.id || obj._id?.toString?.() || String(obj._id) };
}

function toSharedDiscount(doc: any): S.Discount {
  const d = withVirtualId(doc);
  return {
    id: String(d.id),
    restaurantId: String(d.restaurantId),
    branchId: String(d.branchId),
    name: String(d.name),
    type: d.type,
    value: Number(d.value),
    maxAmount: d.maxAmount ?? undefined,
    minOrderAmount: d.minOrderAmount ?? undefined,
    isActive: Boolean(d.isActive),
    requiresManagerApproval: Boolean(d.requiresManagerApproval),
    approvalThreshold: d.approvalThreshold ?? undefined,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

@Injectable()
export class DiscountsService {
  constructor(
    @InjectModel(Discount.name)
    private readonly discountModel: Model<Discount>
  ) {}

  async listDiscounts(
    ctx: AuthContext,
    filters: ListDiscountsFilters = {}
  ): Promise<PaginatedResult<S.Discount>> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId, restaurantId };
    if (filters.isActive !== undefined) query.isActive = filters.isActive;
    if (filters.q) {
      (query as any).$or = [{ name: { $regex: filters.q, $options: 'i' } }];
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

    const docs = await this.discountModel
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
      cursor = Buffer.from(JSON.stringify({ _id: String(last._id) })).toString(
        'base64'
      );
    }

    return { data: data.map(toSharedDiscount), meta: { cursor, count, hasMore } };
  }

  async createDiscount(
    ctx: AuthContext,
    input: CreateDiscountInput
  ): Promise<S.Discount> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestException('Discount name is required');
    }
    if (input.type !== 'PERCENTAGE' && input.type !== 'FIXED') {
      throw new BadRequestException('Invalid discount type');
    }
    if (input.value === undefined || input.value < 0) {
      throw new BadRequestException('Discount value must be >= 0');
    }

    const doc = await this.discountModel.create({
      restaurantId,
      branchId,
      name: input.name,
      type: input.type,
      value: input.value,
      maxAmount: input.maxAmount,
      minOrderAmount: input.minOrderAmount,
      isActive: input.isActive ?? true,
      requiresManagerApproval: input.requiresManagerApproval ?? false,
      approvalThreshold: input.approvalThreshold,
    });

    return toSharedDiscount(doc);
  }

  async updateDiscount(
    ctx: AuthContext,
    id: string,
    input: UpdateDiscountInput
  ): Promise<S.Discount> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const existing = await this.discountModel
      .findOne({ _id: id, branchId, restaurantId })
      .exec();
    if (!existing) throw new NotFoundException(`Discount ${id} not found`);

    const updated = await this.discountModel
      .findByIdAndUpdate(existing._id, { $set: input }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Discount disappeared');

    return toSharedDiscount(updated);
  }
}

