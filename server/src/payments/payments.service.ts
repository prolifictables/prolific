import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as S from '@prolific/shared-types';
import { Payment } from './schemas/payment.schema';
import { Order } from '../orders/schemas/order.schema';
import { Shift } from '../shifts/schemas/shift.schema';
import { Customer } from '../customers/schemas/customer.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { PaymentProviderFactory } from './payment-provider-factory.service';
import {
  PaymentProvider,
  InitializePaymentResult,
  VerifyPaymentResult,
} from './interfaces/payment-provider.interface';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  idempotencyKey: string;
  orderId: string;
  amountCents: number;
  tipCents?: number;
  currency?: string;
  method:
    | 'CASH'
    | 'CARD'
    | 'BANK_TRANSFER'
    | 'ONLINE_PAYSTACK'
    | 'ONLINE_FLUTTERWAVE'
    | 'OTHER';
  notes?: string;
  customerName?: string;
  customerPhone?: string;
  shiftId?: string;
  deviceId?: string;
  transactionReference?: string;
  provider?: string;
  providerPaymentId?: string;
  providerResponse?: Record<string, unknown>;
}

export interface ListPaymentsFilters {
  orderId?: string;
  status?: S.PaymentStatus;
  method?: string;
  dateFrom?: Date;
  dateTo?: Date;
  shiftId?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedPaymentsResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
    requestId: string | undefined;
    timestamp: string | undefined;
  };
}

// Valid payment methods per user spec
const VALID_PAYMENT_METHODS = new Set([
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'ONLINE_PAYSTACK',
  'ONLINE_FLUTTERWAVE',
  'OTHER',
]);

// ONLINE methods — these require PROVIDER verification
const ONLINE_METHODS = new Set(['ONLINE_PAYSTACK', 'ONLINE_FLUTTERWAVE']);

// Payment statuses that count as "realized money" when calculating total due
const REALIZED_PAYMENT_STATUSES = new Set([
  S.PaymentStatus.PAID,
  S.PaymentStatus.PENDING,
  S.PaymentStatus.PARTIALLY_PAID,
]);

const REFUNDABLE_STATUSES = new Set([S.PaymentStatus.PAID]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => PaymentProviderFactory))
    private readonly paymentProviderFactory: PaymentProviderFactory
  ) {}

  // =========================================================================
  // 1. recordPayment
  // =========================================================================

  async recordPayment(
    ctx: AuthContext,
    input: RecordPaymentInput
  ): Promise<Payment> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    // --- Step 1: Enforce idempotency globally ---
    const existingPayment = await this.paymentModel
      .findOne({ idempotencyKey: input.idempotencyKey })
      .exec();
    if (existingPayment) {
      this.logger.log(
        `Idempotent replay: returning existing payment ${existingPayment._id}`
      );
      return this.withVirtualId(existingPayment);
    }

    // --- Step 2: Verify method is valid ---
    if (!VALID_PAYMENT_METHODS.has(input.method)) {
      throw new BadRequestException(
        `Invalid payment method: ${input.method}. Valid: ${Array.from(
          VALID_PAYMENT_METHODS
        ).join(', ')}`
      );
    }

    // --- Step 3: Resolve order and validate it belongs to this branch ---
    const order = await this.orderModel
      .findOne({ _id: input.orderId, branchId })
      .exec();
    if (!order) {
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }

    // --- Step 4: Compute total due for the order ---
    const realizedPayments = await this.paymentModel
      .find({
        orderId: input.orderId,
        status: { $in: Array.from(REALIZED_PAYMENT_STATUSES) },
      })
      .exec();
    const sumExisting = realizedPayments.reduce(
      (acc, p) => acc + p.amountCents,
      0
    );
    const totalDueCents = Math.max(0, order.totalCents - sumExisting);

    // --- Step 5: Validate amount + handle overpayment (allow up to tipCents) ---
    const requestedAmount = input.amountCents;
    const tip = input.tipCents ?? 0;
    const maxAllowed = totalDueCents + tip;

    if (requestedAmount <= 0) {
      throw new BadRequestException('Payment amount must be positive');
    }
    if (requestedAmount > maxAllowed && tip > 0) {
      throw new BadRequestException(
        `Payment amount ${requestedAmount} exceeds totalDue + tip (${totalDueCents} + ${tip} = ${maxAllowed})`
      );
    }
    // If no tip specified, disallow overpayment beyond what's due
    if (tip === 0 && requestedAmount > totalDueCents && totalDueCents > 0) {
      throw new BadRequestException(
        `Overpayment without explicit tip: amount=${requestedAmount} due=${totalDueCents}. Provide tipCents to allow overpayment.`
      );
    }

    // Change due (if customer overpaid via cash with no tip accounted for)
    const changeDueCents = Math.max(0, requestedAmount - totalDueCents - tip);

    // --- Step 6: Resolve verification source ---
    const verificationSource = ONLINE_METHODS.has(input.method)
      ? 'PROVIDER'
      : 'LOCAL';

    let providerName: PaymentProvider | undefined;
    if (input.method === 'ONLINE_PAYSTACK') providerName = 'PAYSTACK';
    else if (input.method === 'ONLINE_FLUTTERWAVE') providerName = 'FLUTTERWAVE';

    const resolvedProvider = input.provider ?? providerName;
    let resolvedTxnRef = input.transactionReference;
    let resolvedProviderResponse = input.providerResponse;
    let initialStatus: S.PaymentStatus;

    if (ONLINE_METHODS.has(input.method)) {
      if (!resolvedTxnRef && resolvedProvider) {
        try {
          const adapter = this.paymentProviderFactory.get(resolvedProvider as PaymentProvider);
          const customerEmail = (input as any).customerEmail ?? (ctx as any).email ?? 'unknown@local';
          const initResult: InitializePaymentResult = await adapter.initialize({
            amountCents: requestedAmount,
            currency: input.currency ?? 'NGN',
            email: customerEmail,
            customerId: order.customerId?.toString(),
            orderId: input.orderId,
            branchId,
            restaurantId,
            callbackUrl:
              (input as any).callbackUrl ||
              `${process.env.APP_URL || 'http://localhost:3001'}/payments/callback`,
            metadata: {
              method: input.method,
              inputShiftId: input.shiftId,
              ...((input as any).metadata || {}),
            },
          });
          resolvedTxnRef = initResult.transactionReference;
          resolvedProviderResponse = {
            ...(resolvedProviderResponse || {}),
            initializeResult: initResult,
          };
          initialStatus = S.PaymentStatus.PENDING;
        } catch (initErr) {
          this.logger.warn(
            `Online initialize failed for ${resolvedProvider}: ${(initErr as Error).message} — setting FAILED`
          );
          initialStatus = S.PaymentStatus.FAILED;
          resolvedProviderResponse = {
            ...(resolvedProviderResponse || {}),
            initializeError: (initErr as Error).message,
          };
        }
      } else {
        initialStatus = S.PaymentStatus.PENDING;
      }
    } else {
      initialStatus = S.PaymentStatus.PAID;
    }

    // --- Step 7: Resolve shiftId ---
    let shiftId = input.shiftId;
    if (!shiftId && ctx.employeeId) {
      // Find the latest OPEN shift for this employee
      const latestOpen = await this.shiftModel
        .findOne({
          employeeId: ctx.employeeId,
          status: 'OPEN',
          branchId,
        })
        .sort({ openingTimestamp: -1 })
        .exec();
      if (latestOpen) {
        shiftId = latestOpen._id.toString();
      }
    }

    // --- Step 8: Create the payment document ---
    const payment = await this.paymentModel.create({
      restaurantId,
      branchId,
      orderId: input.orderId,
      tableSessionId: order.tableSessionId,
      customerId: order.customerId,
      employeeId: ctx.employeeId ?? undefined,
      shiftId,
      amountCents: requestedAmount,
      currency: input.currency ?? 'USD',
      method: input.method,
      verificationSource,
      status: initialStatus,
      transactionReference: resolvedTxnRef,
      provider: resolvedProvider,
      providerPaymentId: input.providerPaymentId,
      providerResponse: resolvedProviderResponse,
      isSplitPayment: false,
      paidByCustomerName: input.customerName,
      paidByPhone: input.customerPhone,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId,
      completedAt:
        initialStatus === S.PaymentStatus.PAID ? new Date() : undefined,
      failedAt:
        initialStatus === S.PaymentStatus.FAILED ? new Date() : undefined,
    });

    // Ensure the originating order is attributed to the cashier shift that collected payment.
    // (Orders may be created without shiftId; sales/shift reports require consistent linkage.)
    if (shiftId && !order.shiftId) {
      const patch: Record<string, unknown> = { shiftId };
      if (!order.employeeId && ctx.employeeId) patch.employeeId = ctx.employeeId;
      await this.orderModel.findByIdAndUpdate(order._id, { $set: patch }).exec();
    }

    // --- Step 9: Recompute order.paymentStatus based on sum of all realized payments ---
    if (initialStatus === S.PaymentStatus.PAID) {
      const newPaidSum = sumExisting + requestedAmount;
      let newOrderPaymentStatus: S.PaymentStatus;
      if (newPaidSum >= order.totalCents) {
        newOrderPaymentStatus = S.PaymentStatus.PAID;
      } else if (newPaidSum > 0) {
        newOrderPaymentStatus = S.PaymentStatus.PARTIALLY_PAID;
      } else {
        newOrderPaymentStatus = S.PaymentStatus.UNPAID;
      }

      const orderUpdates: Record<string, unknown> = {
        paymentStatus: newOrderPaymentStatus,
      };

      // Auto-trigger: if order was AWAITING_PAYMENT and is now fully paid,
      // advance order.status to RECEIVED per docs/09-state-machines.md rule #4.
      // (PAYMENT_CONFIRMED is not in the shared S.OrderStatus enum, so we skip
      //  that intermediate step and go directly to RECEIVED.)
      if (
        order.status === S.OrderStatus.AWAITING_PAYMENT &&
        newOrderPaymentStatus === S.PaymentStatus.PAID
      ) {
        orderUpdates.status = S.OrderStatus.RECEIVED;
      }

      await this.orderModel
        .findByIdAndUpdate(order._id, { $set: orderUpdates }, { new: true })
        .exec();
    }

    // --- Step 10: If change due is positive, log a note (change is a cashier action) ---
    if (changeDueCents > 0) {
      this.logger.log(
        `Payment ${payment._id}: change due ${changeDueCents} to customer`
      );
    }

    return this.withVirtualId(payment);
  }

  // =========================================================================
  // 2. refundPayment
  // =========================================================================

  async refundPayment(
    ctx: AuthContext,
    paymentId: string,
    amountCents?: number,
    reason?: string,
    approvalToken?: string
  ): Promise<Payment> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    // Approval is always required for refunds
    await this.verifyApprovalToken(ctx, approvalToken, {
      action: S.AuditAction.REFUND,
      entityType: 'PAYMENT',
      entityId: paymentId,
    });

    const payment = await this.paymentModel
      .findOne({ _id: paymentId, branchId })
      .exec();
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    if (!REFUNDABLE_STATUSES.has(payment.status)) {
      throw new BadRequestException(
        `Payment status ${payment.status} is not refundable. Must be PAID.`
      );
    }

    // Determine refund amount
    const maxRefundable = payment.amountCents;
    const refundAmount = amountCents ?? maxRefundable;
    const isFullRefund = refundAmount >= maxRefundable;

    if (refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be positive');
    }
    if (refundAmount > maxRefundable) {
      throw new BadRequestException(
        `Refund amount ${refundAmount} exceeds payment amount ${maxRefundable}`
      );
    }

    // Update the payment row
    const newStatus = isFullRefund
      ? S.PaymentStatus.REFUNDED
      : S.PaymentStatus.PARTIALLY_REFUNDED;

    const updated = await this.paymentModel
      .findByIdAndUpdate(
        payment._id,
        {
          $set: {
            status: newStatus,
            refundReason: reason,
            refundedById: ctx.employeeId ?? undefined,
            refundedAt: new Date(),
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Payment disappeared during refund');

    // Recompute order.paymentStatus
    await this.recomputeOrderPaymentStatus(payment.orderId);

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 3. listPayments — cursor pagination, filtered by branch
  // =========================================================================

  async listPayments(
    ctx: AuthContext,
    filters: ListPaymentsFilters = {}
  ): Promise<PaginatedPaymentsResult<Payment>> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId };

    if (filters.orderId) query.orderId = filters.orderId;
    if (filters.status) query.status = filters.status;
    if (filters.method) query.method = filters.method;
    if (filters.shiftId) query.shiftId = filters.shiftId;
    if (filters.dateFrom || filters.dateTo) {
      query.completedAt = {} as Record<string, Date>;
      if (filters.dateFrom) {
        (query.completedAt as Record<string, Date>).$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        (query.completedAt as Record<string, Date>).$lte = filters.dateTo;
      }
    }

    // Cursor pagination
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id && (parsed.createdAt || parsed.completedAt)) {
          const tsField = parsed.completedAt ? 'completedAt' : 'createdAt';
          const tsValue = parsed.completedAt || parsed.createdAt;
          query.$or = [
            { [tsField]: { $lt: new Date(tsValue) } },
            {
              [tsField]: { $eq: new Date(tsValue) },
              _id: { $lt: new Types.ObjectId(parsed._id) },
            },
          ];
        }
      } catch (e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.paymentModel
      .find(query)
      .sort({ completedAt: -1, createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1] as unknown as {
        _id: Types.ObjectId;
        completedAt?: Date;
        createdAt: Date;
      };
      cursor = Buffer.from(
        JSON.stringify({
          _id: last._id.toString(),
          completedAt: last.completedAt?.toISOString(),
          createdAt: last.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      data: data.map((d) => this.withVirtualId(d)),
      meta: {
        cursor,
        count,
        hasMore,
        requestId: undefined,
        timestamp: undefined,
      },
    };
  }

  // =========================================================================
  // 4. getPayment
  // =========================================================================

  async getPayment(ctx: AuthContext, id: string): Promise<Payment> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const payment = await this.paymentModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return this.withVirtualId(payment);
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Recomputes an order's paymentStatus based on the sum of all
   * PAID / PARTIALLY_PAID payments against it.
   *
   * NOTE: This is the ONLY place outside recordPayment that should ever
   * mutate order.paymentStatus. It is called only from refundPayment,
   * which is already a guarded, audited service method.
   */
  private async recomputeOrderPaymentStatus(orderId: string): Promise<void> {
    const order = await this.orderModel.findById(orderId).exec();
    if (!order) return;

    const realized = await this.paymentModel
      .find({
        orderId,
        status: {
          $in: [
            S.PaymentStatus.PAID,
            S.PaymentStatus.PENDING,
            S.PaymentStatus.PARTIALLY_PAID,
          ],
        },
      })
      .exec();

    // Subtract any refunded amounts
    const refunded = await this.paymentModel
      .find({
        orderId,
        status: {
          $in: [S.PaymentStatus.REFUNDED, S.PaymentStatus.PARTIALLY_REFUNDED],
        },
      })
      .exec();

    const paidSum = realized.reduce((acc, p) => acc + p.amountCents, 0);
    const refundedSum = refunded.reduce((acc, p) => acc + p.amountCents, 0);
    const netPaid = Math.max(0, paidSum - refundedSum);

    let newStatus: S.PaymentStatus;
    if (netPaid >= order.totalCents) {
      newStatus = S.PaymentStatus.PAID;
    } else if (netPaid > 0) {
      newStatus = S.PaymentStatus.PARTIALLY_PAID;
    } else {
      newStatus = S.PaymentStatus.UNPAID;
    }

    // If full refund, order status may need to go back (but we respect
    // the state machine — only mutate paymentStatus here, per invariants).
    await this.orderModel
      .findByIdAndUpdate(order._id, { $set: { paymentStatus: newStatus } })
      .exec();

    // If table session, update its paidAmount / balanceDue
    // Note: we recompute from scratch instead of computing deltas, to avoid drift
    if (order.tableSessionId) {
      // Recalculate all payments for the entire session for accuracy
      const allSessionOrders = await this.orderModel
        .find({ tableSessionId: order.tableSessionId })
        .exec();
      let sessionPaid = 0;
      let sessionTotal = 0;
      for (const so of allSessionOrders) {
        sessionTotal += so.totalCents;
        const soPayments = await this.paymentModel
          .find({
            orderId: so._id.toString(),
            status: {
              $in: [
                S.PaymentStatus.PAID,
                S.PaymentStatus.PENDING,
                S.PaymentStatus.PARTIALLY_PAID,
              ],
            },
          })
          .exec();
        const soRefunds = await this.paymentModel
          .find({
            orderId: so._id.toString(),
            status: {
              $in: [S.PaymentStatus.REFUNDED, S.PaymentStatus.PARTIALLY_REFUNDED],
            },
          })
          .exec();
        const soPaid = soPayments.reduce((a, p) => a + p.amountCents, 0);
        const soRef = soRefunds.reduce((a, p) => a + p.amountCents, 0);
        sessionPaid += Math.max(0, soPaid - soRef);
      }

      const newBalance = Math.max(0, sessionTotal - sessionPaid);
      const newSessionStatus =
        newBalance === 0
          ? S.TableSessionStatus.PAID
          : sessionPaid > 0
          ? S.TableSessionStatus.PARTIALLY_PAID
          : S.TableSessionStatus.OPEN;

      await this.orderModel.db
        .model('TableSession')
        .findByIdAndUpdate(order.tableSessionId, {
          $set: {
            totalAmount: sessionTotal,
            paidAmount: sessionPaid,
            balanceDue: newBalance,
            status: newSessionStatus,
          },
        })
        .exec();
    }
  }

  // =========================================================================
  // completeOnlinePayment — called from webhook controller when provider
  // confirms a charge.success / charge.completed event.
  // =========================================================================

  async completeOnlinePayment(
    provider: PaymentProvider,
    transactionReference: string,
    rawWebhookPayload?: any
  ): Promise<Payment | null> {
    this.logger.log(
      `completeOnlinePayment: provider=${provider} ref=${transactionReference}`
    );

    const payment = await this.paymentModel
      .findOne({
        provider,
        transactionReference,
        status: { $in: [S.PaymentStatus.PENDING, S.PaymentStatus.PAID] },
      })
      .exec();

    if (!payment) {
      this.logger.warn(
        `completeOnlinePayment: no payment found for provider=${provider} ref=${transactionReference}`
      );
      return null;
    }

    if (payment.status === S.PaymentStatus.PAID) {
      this.logger.log(
        `completeOnlinePayment: idempotent replay — payment ${payment._id} already PAID`
      );
      return this.withVirtualId(payment);
    }

    let verifyResult: VerifyPaymentResult | null = null;
    try {
      const adapter = this.paymentProviderFactory.get(provider);
      verifyResult = await adapter.verify(transactionReference);
    } catch (err) {
      this.logger.warn(
        `completeOnlinePayment: provider verify failed (continuing with webhook payload alone): ${(err as Error).message}`
      );
    }

    const verified = verifyResult ? verifyResult.verified : true;
    const actualAmountCents =
      verifyResult && verifyResult.verified
        ? verifyResult.amountCents
        : payment.amountCents;

    if (!verified) {
      this.logger.warn(
        `completeOnlinePayment: provider verification reported NOT verified — marking FAILED. ref=${transactionReference}`
      );
      await this.paymentModel
        .findByIdAndUpdate(payment._id, {
          $set: {
            status: S.PaymentStatus.FAILED,
            failedAt: new Date(),
            providerResponse: {
              ...((payment.providerResponse as any) || {}),
              verifyResult,
              webhook: rawWebhookPayload,
              failureReason:
                verifyResult?.failureReason || 'provider verification failed',
            },
          },
        })
        .exec();
      return this.withVirtualId((await this.paymentModel.findById(payment._id).exec())!);
    }

    const now = new Date();
    const feeCents = verifyResult?.feeCents;

    await this.paymentModel
      .findByIdAndUpdate(payment._id, {
        $set: {
          status: S.PaymentStatus.PAID,
          completedAt: now,
          amountCents: actualAmountCents,
          providerResponse: {
            ...((payment.providerResponse as any) || {}),
            verifyResult,
            webhook: rawWebhookPayload,
            settledAt: verifyResult?.settledAt || now,
            payerAccount: verifyResult?.payerAccount,
            feeCents,
          },
        },
      })
      .exec();

    const order = await this.orderModel.findById(payment.orderId).exec();
    if (order) {
      const realized = await this.paymentModel
        .find({
          orderId: payment.orderId,
          status: {
            $in: [
              S.PaymentStatus.PAID,
              S.PaymentStatus.PENDING,
              S.PaymentStatus.PARTIALLY_PAID,
            ],
          },
        })
        .exec();
      const refunded = await this.paymentModel
        .find({
          orderId: payment.orderId,
          status: {
            $in: [S.PaymentStatus.REFUNDED, S.PaymentStatus.PARTIALLY_REFUNDED],
          },
        })
        .exec();
      const paidSum = realized.reduce((acc, p) => acc + p.amountCents, 0);
      const refundedSum = refunded.reduce((acc, p) => acc + p.amountCents, 0);
      const netPaid = Math.max(0, paidSum - refundedSum);

      let newPaymentStatus: S.PaymentStatus;
      if (netPaid >= order.totalCents) {
        newPaymentStatus = S.PaymentStatus.PAID;
      } else if (netPaid > 0) {
        newPaymentStatus = S.PaymentStatus.PARTIALLY_PAID;
      } else {
        newPaymentStatus = S.PaymentStatus.UNPAID;
      }

      const orderUpdates: Record<string, unknown> = {
        paymentStatus: newPaymentStatus,
      };

      if (
        order.status === S.OrderStatus.AWAITING_PAYMENT &&
        newPaymentStatus === S.PaymentStatus.PAID
      ) {
        orderUpdates.status = S.OrderStatus.RECEIVED;
      }

      await this.orderModel
        .findByIdAndUpdate(order._id, { $set: orderUpdates }, { new: true })
        .exec();

      await this.recomputeOrderPaymentStatus(payment.orderId);
    }

    const updated = await this.paymentModel.findById(payment._id).exec();
    return updated ? this.withVirtualId(updated) : null;
  }

  /**
   * Verifies the short-lived manager approval JWT for sensitive actions.
   */
  private async verifyApprovalToken(
    ctx: AuthContext,
    approvalToken: string | undefined,
    expectedScope: {
      action: S.AuditAction;
      entityType: string;
      entityId: string;
    }
  ): Promise<void> {
    if (!approvalToken) {
      throw new UnauthorizedException(
        `Manager approval token required for ${expectedScope.action} on ${expectedScope.entityType}`
      );
    }
    try {
      const decoded = (await this.jwtService.verifyAsync(approvalToken, {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      })) as {
        tokenType: string;
        approverId: string;
        approverRole: S.Role;
        scope: {
          action: S.AuditAction;
          entityType: string;
          entityId: string;
        };
      };

      if (decoded.tokenType !== 'approval') {
        throw new ForbiddenException('Token is not an approval token');
      }
      if (!decoded.scope) {
        throw new ForbiddenException('Approval token missing scope');
      }
      if (decoded.scope.action !== expectedScope.action) {
        throw new ForbiddenException(
          `Approval scope action mismatch: expected ${expectedScope.action}, got ${decoded.scope.action}`
        );
      }
      if (decoded.scope.entityType !== expectedScope.entityType) {
        throw new ForbiddenException(
          `Approval scope entityType mismatch: expected ${expectedScope.entityType}`
        );
      }
      if (decoded.scope.entityId !== expectedScope.entityId) {
        throw new ForbiddenException(
          `Approval scope entityId mismatch: expected ${expectedScope.entityId}`
        );
      }

      const managerRoles = new Set([
        S.Role.MANAGER,
        S.Role.SUPERVISOR,
        S.Role.ADMIN,
        S.Role.SUPER_ADMIN,
      ]);
      if (!managerRoles.has(decoded.approverRole)) {
        throw new ForbiddenException(
          `Approver role ${decoded.approverRole} does not have approval authority`
        );
      }
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof UnauthorizedException) {
        throw e;
      }
      this.logger.warn(
        `Approval token verification failed: ${(e as Error).message}`
      );
      throw new ForbiddenException('Invalid or expired approval token');
    }
  }

  /**
   * Attaches a virtual 'id' field (stringified _id) to match S.Payment interface.
   */
  private withVirtualId<T extends Payment>(doc: T): T {
    const result = doc as unknown as T & { id: string };
    if (!result.id) {
      result.id = result._id.toString();
    }
    return result;
  }
}
