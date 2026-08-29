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
import {
  InventoryService,
  CreateInventoryItemInput,
} from './inventory.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

interface WastageBody {
  quantity: number;
  reason?: string;
}

interface AdjustmentBody {
  newQuantity: number;
  reason?: string;
}

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('items')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_VIEW)
  async listInventoryItems(
    @Query()
    query: {
      lowStockOnly?: string;
      supplierId?: string;
      q?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: {
      lowStockOnly?: boolean;
      supplierId?: string;
      q?: string;
      cursor?: string;
      limit?: number;
    } = {};
    if (query.lowStockOnly !== undefined) {
      filters.lowStockOnly = query.lowStockOnly === 'true';
    }
    if (query.supplierId) filters.supplierId = query.supplierId;
    if (query.q) filters.q = query.q;
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.inventoryService.listInventoryItems(user, filters);
  }

  @Post('items')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'INVENTORY_ITEM',
    captureChanges: true,
  })
  async createItem(
    @Body() body: CreateInventoryItemInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.inventoryService.createItem(user, body);
  }

  @Patch('items/:itemId/stock')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'INVENTORY_ITEM',
    captureChanges: true,
  })
  async updateStockLevel(
    @Param('itemId') itemId: string,
    @Body()
    body: {
      quantityChange: number;
      type?: S.InventoryTransactionType;
      reason?: string;
      supplierId?: string;
      shiftId?: string;
      referenceId?: string;
      referenceType?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    return this.inventoryService.updateStockLevel(user, itemId, body);
  }

  @Post('items/:itemId/wastage')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'INVENTORY_ITEM',
    captureChanges: true,
  })
  async recordWastage(
    @Param('itemId') itemId: string,
    @Body() body: WastageBody,
    @CurrentUser() user: AuthContext
  ) {
    return this.inventoryService.recordWastage(
      user,
      itemId,
      body.quantity,
      body.reason
    );
  }

  @Post('items/:itemId/adjustment')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'INVENTORY_ITEM',
    captureChanges: true,
  })
  async recordAdjustment(
    @Param('itemId') itemId: string,
    @Body() body: AdjustmentBody,
    @CurrentUser() user: AuthContext
  ) {
    return this.inventoryService.recordAdjustment(
      user,
      itemId,
      body.newQuantity,
      body.reason
    );
  }

  @Get('items/:itemId/history')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_VIEW)
  async listStockHistory(
    @Param('itemId') itemId: string,
    @Query()
    query: {
      from?: string;
      to?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: {
      from?: Date;
      to?: Date;
      cursor?: string;
      limit?: number;
    } = {};
    if (query.from) filters.from = new Date(query.from);
    if (query.to) filters.to = new Date(query.to);
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.inventoryService.listStockHistory(user, itemId, filters);
  }
}
