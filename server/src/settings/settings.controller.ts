import { Body, Controller, Get, HttpCode, Patch, Query, UseGuards } from '@nestjs/common';
import * as S from '@prolific/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_VIEW)
  async getBranchSettings(
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: AuthContext
  ) {
    return this.settingsService.getBranchSettings(user, { branchId });
  }

  @Patch()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({ action: S.AuditAction.UPDATE, entityType: 'SETTINGS', captureChanges: true })
  async patchBranchSettings(
    @Query('branchId') branchId: string | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthContext
  ) {
    return this.settingsService.patchBranchSettings(user, body, { branchId });
  }
}

