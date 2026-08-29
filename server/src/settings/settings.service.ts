import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { Setting } from './schemas/setting.schema';

const BRANCH_SETTINGS_KEY = 'branch.settings';

@Injectable()
export class SettingsService {
  constructor(@InjectModel(Setting.name) private readonly settingModel: Model<Setting>) {}

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

  async getBranchSettings(ctx: AuthContext, opts: { branchId?: string } = {}) {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) throw new BadRequestException('Restaurant context required');
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const row = await this.settingModel
      .findOne({ restaurantId, branchId, key: BRANCH_SETTINGS_KEY, scope: 'BRANCH' })
      .exec();

    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    return value;
  }

  async patchBranchSettings(
    ctx: AuthContext,
    input: Record<string, unknown>,
    opts: { branchId?: string } = {}
  ) {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) throw new BadRequestException('Restaurant context required');
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const existing = await this.settingModel
      .findOne({ restaurantId, branchId, key: BRANCH_SETTINGS_KEY, scope: 'BRANCH' })
      .exec();

    const currentValue =
      existing?.value && typeof existing.value === 'object' ? (existing.value as any) : {};

    const next = { ...currentValue, ...input };

    const updated =
      existing ||
      new this.settingModel({
        restaurantId,
        branchId,
        key: BRANCH_SETTINGS_KEY,
        scope: 'BRANCH',
        valueType: 'OBJECT',
      });

    updated.value = next;
    updated.updatedBy = ctx.employeeId || ctx.userId || 'system';

    await updated.save();
    return next;
  }
}

