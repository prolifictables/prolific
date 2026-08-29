import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { Branch } from './schemas/branch.schema';

@Injectable()
export class BranchesService {
  constructor(@InjectModel(Branch.name) private readonly branchModel: Model<Branch>) {}

  private resolveRestaurantId(ctx: AuthContext, restaurantIdParam?: string): string {
    const isSuperAdmin = ctx.role === S.Role.SUPER_ADMIN;
    const restaurantId = ctx.restaurantId || restaurantIdParam || null;
    if (isSuperAdmin && !ctx.restaurantId && !restaurantIdParam) {
      throw new BadRequestException(
        'restaurantId is required for SUPER_ADMIN without restaurant context'
      );
    }
    if (!restaurantId) throw new BadRequestException('Restaurant context required');
    return restaurantId;
  }

  async listBranches(ctx: AuthContext, opts: { restaurantId?: string; includeInactive?: boolean } = {}) {
    const restaurantId = this.resolveRestaurantId(ctx, opts.restaurantId);
    const q: any = { restaurantId };
    if (!opts.includeInactive) q.isActive = true;
    return this.branchModel.find(q).sort({ name: 1 }).exec();
  }
}

