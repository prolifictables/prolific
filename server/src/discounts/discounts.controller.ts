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
import { Audit } from '../common/decorators/audit.decorator';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import {
  DiscountsService,
  CreateDiscountInput,
  UpdateDiscountInput,
} from './discounts.service';

@Controller('discounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_VIEW)
  async listDiscounts(
    @Query()
    query: {
      isActive?: string;
      q?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    return this.discountsService.listDiscounts(user, {
      isActive:
        query.isActive !== undefined ? query.isActive === 'true' : undefined,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({ action: S.AuditAction.CREATE, entityType: 'DISCOUNT', captureChanges: true })
  async createDiscount(
    @Body() body: CreateDiscountInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.discountsService.createDiscount(user, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'DISCOUNT',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateDiscount(
    @Param('id') id: string,
    @Body() body: UpdateDiscountInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.discountsService.updateDiscount(user, id, body);
  }
}

