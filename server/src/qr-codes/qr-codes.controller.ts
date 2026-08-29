import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import {
  QrCodesService,
  ListQrsFilters,
} from './qr-codes.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('qr-codes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_VIEW)
  async listQrs(
    @Query() query: { tableId?: string; isActive?: string },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListQrsFilters = {};
    if (query.tableId) filters.tableId = query.tableId;
    if (query.isActive !== undefined) filters.isActive = query.isActive === 'true';
    return this.qrCodesService.listQrs(user, filters);
  }

  @Post('tables/:tableId/regenerate')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'QR_CODE',
    captureChanges: true,
  })
  async regenerateQrForTable(
    @Param('tableId') tableId: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.qrCodesService.regenerateQrForTable(user, tableId);
  }

  @Get('pdf')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  async downloadQrPdf(
    @Query() query: { tableIds?: string; all?: string },
    @CurrentUser() user: AuthContext
  ) {
    const opts: { tableIds?: string[]; all?: boolean } = {};
    if (query.tableIds) {
      opts.tableIds = query.tableIds.split(',');
    }
    if (query.all !== undefined) {
      opts.all = query.all === 'true';
    }
    return this.qrCodesService.downloadQrPdf(user, opts);
  }
}
