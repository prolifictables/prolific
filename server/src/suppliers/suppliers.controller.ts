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
  SuppliersService,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreatePurchaseOrderInput,
  ReceivePurchaseOrderInput,
} from './suppliers.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get('suppliers')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_VIEW)
  async listSuppliers(
    @Query()
    query: {
      q?: string;
      isActive?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.listSuppliers(user, {
      q: query.q,
      isActive:
        query.isActive !== undefined ? query.isActive === 'true' : undefined,
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Post('suppliers')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({ action: S.AuditAction.CREATE, entityType: 'SUPPLIER', captureChanges: true })
  async createSupplier(
    @Body() body: CreateSupplierInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.createSupplier(user, body);
  }

  @Patch('suppliers/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'SUPPLIER',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: UpdateSupplierInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.updateSupplier(user, id, body);
  }

  @Get('purchase-orders')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_VIEW)
  async listPurchaseOrders(
    @Query()
    query: {
      supplierId?: string;
      status?: string;
      q?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const status = query.status
      ? query.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s as S.PurchaseOrderStatus)
      : undefined;

    return this.suppliersService.listPurchaseOrders(user, {
      supplierId: query.supplierId,
      status,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  }

  @Post('purchase-orders')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.INVENTORY_PURCHASE)
  @Audit({ action: S.AuditAction.CREATE, entityType: 'PURCHASE_ORDER', captureChanges: true })
  async createPurchaseOrder(
    @Body() body: CreatePurchaseOrderInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.createPurchaseOrder(user, body);
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_PURCHASE)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'PURCHASE_ORDER',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async receivePurchaseOrder(
    @Param('id') id: string,
    @Body() body: ReceivePurchaseOrderInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.receivePurchaseOrder(user, id, body);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_PURCHASE)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'PURCHASE_ORDER',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async cancelPurchaseOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.suppliersService.cancelPurchaseOrder(user, id);
  }
}

