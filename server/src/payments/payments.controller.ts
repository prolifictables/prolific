import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import {
  PaymentsService,
  RecordPaymentInput,
  ListPaymentsFilters,
} from './payments.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ---------------------------------------------------------------------------
  // POST /payments → recordPayment
  // Supports Idempotency-Key header (fallback to body.idempotencyKey)
  // ---------------------------------------------------------------------------
  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.PAYMENT_ACCEPT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'PAYMENT',
    captureChanges: false,
  })
  async recordPayment(
    @Headers('Idempotency-Key') idempotencyKeyHeader: string | undefined,
    @Body() body: RecordPaymentInput,
    @CurrentUser() user: AuthContext
  ) {
    // Merge header idempotency key with body (header takes precedence)
    const input: RecordPaymentInput = {
      ...body,
      idempotencyKey: idempotencyKeyHeader ?? body.idempotencyKey,
    };
    if (!input.idempotencyKey) {
      throw new Error('Idempotency-Key header or body.idempotencyKey is required');
    }
    return this.paymentsService.recordPayment(user, input);
  }

  // ---------------------------------------------------------------------------
  // GET /payments → listPayments
  // ---------------------------------------------------------------------------
  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS)
  async listPayments(
    @Query() query: {
      orderId?: string;
      status?: string;
      method?: string;
      dateFrom?: string;
      dateTo?: string;
      shiftId?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListPaymentsFilters = {};
    if (query.orderId) filters.orderId = query.orderId;
    if (query.status) filters.status = query.status as S.PaymentStatus;
    if (query.method) filters.method = query.method;
    if (query.shiftId) filters.shiftId = query.shiftId;
    if (query.dateFrom) filters.dateFrom = new Date(query.dateFrom);
    if (query.dateTo) filters.dateTo = new Date(query.dateTo);
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.paymentsService.listPayments(user, filters);
  }

  // ---------------------------------------------------------------------------
  // GET /payments/:id → getPayment
  // ---------------------------------------------------------------------------
  @Get(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS)
  async getPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.paymentsService.getPayment(user, id);
  }

  // ---------------------------------------------------------------------------
  // POST /payments/:id/refund → refundPayment (approval guarded)
  // ---------------------------------------------------------------------------
  @Post(':id/refund')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.PAYMENT_REFUND)
  @Audit({
    action: S.AuditAction.REFUND,
    entityType: 'PAYMENT',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async refundPayment(
    @Param('id') id: string,
    @Body() body: {
      amountCents?: number;
      reason?: string;
      approvalToken?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    return this.paymentsService.refundPayment(
      user,
      id,
      body.amountCents,
      body.reason,
      body.approvalToken
    );
  }
}
