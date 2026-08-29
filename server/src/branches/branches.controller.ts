import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import * as S from '@prolific/shared-types';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { BranchesService } from './branches.service';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_VIEW)
  async listBranches(
    @Query('restaurantId') restaurantId: string | undefined,
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: AuthContext
  ) {
    return this.branchesService.listBranches(user, {
      restaurantId,
      includeInactive: includeInactive === 'true',
    });
  }
}

