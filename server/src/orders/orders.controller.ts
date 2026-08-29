import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  OrdersService,
  CreateOrderInput,
  OrderItemInput,
  UpdateOrderStatusOpts,
  ListOrdersFilters,
} from './orders.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';
// Conditionally import zod schema from @prolific/validation if available.
// If not installed or schema not exported, validation is skipped per user spec.
let createOrderZodSchema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createOrderZodSchema = require('@prolific/validation').createOrderSchema ?? null;
} catch (_e) {
  createOrderZodSchema = null;
}

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ---------------------------------------------------------------------------
  // POST /orders → createOrder
  // Conditionally validates body using @prolific/validation schema if available.
  // ---------------------------------------------------------------------------
  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.ORDER_CREATE)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'ORDER',
    captureChanges: false,
  })
  async createOrder(
    @Body() body: CreateOrderInput,
    @CurrentUser() user: AuthContext
  ) {
    // Conditional body validation — only runs if @prolific/validation installed
    if (createOrderZodSchema) {
      const result = createOrderZodSchema.safeParse(body);
      if (!result.success) {
        throw new BadRequestException({
          message: 'Request validation failed',
          details: result.error?.issues,
          code: 'VALIDATION_ERROR',
        });
      }
    }
    return this.ordersService.createOrder(user, body);
  }
 // ---------------------------------------------------------------------------
 // PATCH /orders/:id/status → updateOrderStatus
 // ---------------------------------------------------------------------------
 @Patch(':id/status')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_EDIT)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async updateOrderStatus(@Param('id') id: string, @Body() body: {
 status: S.OrderStatus;
 reason?: string;
 approvalToken?: string;
 }, @CurrentUser() user: AuthContext) {
 const opts: UpdateOrderStatusOpts = {};
 if (body.reason)
 opts.reason = body.reason;
 if (body.approvalToken)
 opts.approvalToken = body.approvalToken;
 return this.ordersService.updateOrderStatus(user, id, body.status, opts);
 }
 // ---------------------------------------------------------------------------
 // GET /orders → listOrders
 // ---------------------------------------------------------------------------
 @Get()
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_VIEW)
 async listOrders(@Query() query: {
 status?: string;
 tableId?: string;
 dateFrom?: string;
 dateTo?: string;
 source?: string;
 search?: string;
 sort?: string;
 cursor?: string;
 limit?: string;
 branchId?: string;
 }, @CurrentUser() user: AuthContext) {
 const filters: ListOrdersFilters = {};
 if (query.status)
 filters.status = query.status as S.OrderStatus;
 if (query.tableId)
 filters.tableId = query.tableId;
 if (query.dateFrom)
 filters.dateFrom = new Date(query.dateFrom);
 if (query.dateTo)
 filters.dateTo = new Date(query.dateTo);
 if (query.source)
 filters.source = query.source;
 if (query.search)
 filters.search = query.search;
 if (query.sort)
 filters.sort = query.sort;
 if (query.cursor)
 filters.cursor = query.cursor;
 if (query.limit)
 filters.limit = parseInt(query.limit, 10);
 if (query.branchId)
 filters.branchId = query.branchId;
 return this.ordersService.listOrders(user, filters);
 }
 // ---------------------------------------------------------------------------
 // GET /orders/:id → getOrder
 // ---------------------------------------------------------------------------
 @Get(':id')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_VIEW)
 async getOrder(@Param('id') id: string, @CurrentUser() user: AuthContext) {
 return this.ordersService.getOrder(user, id);
 }
 // ---------------------------------------------------------------------------
 // POST /orders/:id/items → addItems
 // ---------------------------------------------------------------------------
 @Post(':id/items')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_EDIT)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async addItems(@Param('id') id: string, @Body() body: {
 items: OrderItemInput[];
 }, @CurrentUser() user: AuthContext) {
 return this.ordersService.addItems(user, id, body.items);
 }
 // ---------------------------------------------------------------------------
 // DELETE /orders/:id/items/:index → removeItem
 // ---------------------------------------------------------------------------
 @Delete(':id/items/:index')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_EDIT)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async removeItem(@Param('id') id: string, @Param('index') index: string, @Body() body: {
 reason?: string;
 approvalToken?: string;
 } = {}, @CurrentUser() user: AuthContext) {
 const itemIndex = parseInt(index, 10);
 const opts: UpdateOrderStatusOpts = {};
 if (body.reason)
 opts.reason = body.reason;
 if (body.approvalToken)
 opts.approvalToken = body.approvalToken;
 return this.ordersService.removeItem(user, id, itemIndex, opts);
 }
 // ---------------------------------------------------------------------------
 // POST /orders/:id/hold → holdOrder
 // ---------------------------------------------------------------------------
 @Post(':id/hold')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_HOLD)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async holdOrder(@Param('id') id: string, @CurrentUser() user: AuthContext) {
 return this.ordersService.holdOrder(user, id);
 }
 // ---------------------------------------------------------------------------
 // POST /orders/:id/retrieve → retrieveOrder
 // ---------------------------------------------------------------------------
 @Post(':id/retrieve')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_HOLD)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async retrieveOrder(@Param('id') id: string, @CurrentUser() user: AuthContext) {
 return this.ordersService.retrieveOrder(user, id);
 }
 // ---------------------------------------------------------------------------
 // POST /orders/:id/refund → refundOrder
 // ---------------------------------------------------------------------------
 @Post(':id/refund')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_REFUND)
 @Audit({
 action: S.AuditAction.REFUND,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async refundOrder(@Param('id') id: string, @Body() body: {
 amountCents?: number;
 reason?: string;
 approvalToken?: string;
 }, @CurrentUser() user: AuthContext) {
 return this.ordersService.refundOrder(user, id, body.amountCents, body.reason, body.approvalToken);
 }
 // ---------------------------------------------------------------------------
 // POST /orders/:id/void → voidOrder
 // ---------------------------------------------------------------------------
 @Post(':id/void')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_VOID)
 @Audit({
 action: S.AuditAction.VOID,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async voidOrder(@Param('id') id: string, @Body() body: {
 reason?: string;
 approvalToken?: string;
 }, @CurrentUser() user: AuthContext) {
 return this.ordersService.voidOrder(user, id, body.reason, body.approvalToken);
 }

 @Post(':id/cancel')
 @HttpCode(200)
 @RequiredPermissions(S.Permission.ORDER_CANCEL)
 @Audit({
 action: S.AuditAction.UPDATE,
 entityType: 'ORDER',
 entityIdParam: 'id',
 captureChanges: true,
 })
 async cancelOrder(@Param('id') id: string, @Body() body: {
 reason?: string;
 approvalToken?: string;
 }, @CurrentUser() user: AuthContext) {
 const opts: UpdateOrderStatusOpts = {};
 if (body.reason)
 opts.reason = body.reason;
 if (body.approvalToken)
 opts.approvalToken = body.approvalToken;
 return this.ordersService.updateOrderStatus(user, id, S.OrderStatus.CANCELLED, opts);
 }
}
