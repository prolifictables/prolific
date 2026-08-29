import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { Tax } from './schemas/tax.schema';

export interface CreateTaxInput {
  branchId?: string;
  name: string;
  rate: number;
  isIncludedInPrice: boolean;
  isActive?: boolean;
}

export interface UpdateTaxInput {
  name?: string;
  rate?: number;
  isIncludedInPrice?: boolean;
  isActive?: boolean;
}

@Injectable()
export class TaxesService {
  constructor(@InjectModel(Tax.name) private readonly taxModel: Model<Tax>) {}

  private resolveBranchId(ctx: AuthContext, branchIdParam?: string): string {
    const isSuperAdmin = ctx.role === S.Role.SUPER_ADMIN;
    const branchId = ctx.branchId || branchIdParam || null;
    if (isSuperAdmin && !ctx.branchId && !branchIdParam) {
      throw new BadRequestException(
        'branchId is required for SUPER_ADMIN without branch context'
      );
    }
    if (!branchId) throw new BadRequestException('Branch context required');
    return branchId;
  }

  async listTaxes(
    ctx: AuthContext,
    opts: { branchId?: string; includeInactive?: boolean } = {}
  ) {
    const branchId = this.resolveBranchId(ctx, opts.branchId);
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) throw new BadRequestException('Restaurant context required');

    const q: any = { restaurantId, branchId };
    if (!opts.includeInactive) q.isActive = true;

    return this.taxModel.find(q).sort({ name: 1 }).exec();
  }

  async createTax(ctx: AuthContext, input: CreateTaxInput) {
    const branchId = this.resolveBranchId(ctx, input.branchId);
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) throw new BadRequestException('Restaurant context required');

    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException('Tax rate must be a percentage between 0 and 100');
    }

    const doc = await this.taxModel.create({
      restaurantId,
      branchId,
      name: input.name,
      rate,
      isIncludedInPrice: !!input.isIncludedInPrice,
      isActive: input.isActive ?? true,
    });
    return doc;
  }

  async updateTax(ctx: AuthContext, id: string, input: UpdateTaxInput) {
    const branchId = this.resolveBranchId(ctx);
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) throw new BadRequestException('Restaurant context required');

    const tax = await this.taxModel
      .findOne({ _id: id, restaurantId, branchId })
      .exec();
    if (!tax) throw new NotFoundException(`Tax ${id} not found`);

    if (typeof input.name === 'string') tax.name = input.name;
    if (typeof input.isIncludedInPrice === 'boolean') {
      tax.isIncludedInPrice = input.isIncludedInPrice;
    }
    if (typeof input.isActive === 'boolean') tax.isActive = input.isActive;
    if (typeof input.rate !== 'undefined') {
      const rate = Number(input.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new BadRequestException('Tax rate must be a percentage between 0 and 100');
      }
      tax.rate = rate;
    }

    await tax.save();
    return tax;
  }
}

