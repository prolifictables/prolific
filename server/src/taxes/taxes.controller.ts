import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { TaxesService, CreateTaxInput, UpdateTaxInput } from './taxes.service';

@Controller('taxes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_VIEW)
  async listTaxes(
    @Query('branchId') branchId: string | undefined,
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: AuthContext
  ) {
    return this.taxesService.listTaxes(user, {
      branchId,
      includeInactive: includeInactive === 'true',
    });
  }

  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({ action: S.AuditAction.CREATE, entityType: 'TAX', captureChanges: false })
  async createTax(@Body() body: CreateTaxInput, @CurrentUser() user: AuthContext) {
    return this.taxesService.createTax(user, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'TAX',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateTax(
    @Param('id') id: string,
    @Body() body: UpdateTaxInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.taxesService.updateTax(user, id, body);
  }
}

