import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import { AuthContext } from '../common/decorators/current-user.decorator';
import { SyncRecord } from './schemas/sync-record.schema';
import { Order } from '../orders/schemas/order.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { Shift } from '../shifts/schemas/shift.schema';
import { CashAdjustment } from '../shifts/schemas/cash-adjustment.schema';
import { AuditLogsService } from '../audit/audit-logs.service';

export interface SyncCommand {
  idempotencyKey: string;
  entityType: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  entityId?: string;
  payload: Record<string, unknown>;
  localEntityVersion?: number;
  entityCreatedAt?: Date;
  entityUpdatedAt?: Date;
}

export interface SyncResult {
  idempotencyKey: string;
  entityType: string;
  entityId: string | null;
  status: 'PENDING' | 'SUCCESS' | 'CONFLICT' | 'FAILED' | 'RETRYING';
  serverEntityVersion?: number;
  conflictResolution?: 'SERVER_WINS' | 'CLIENT_WINS' | 'MERGED' | 'UNRESOLVED';
  serverSnapshot?: Record<string, unknown> | null;
  errorMessage?: string;
  attemptCount: number;
  appliedAt?: Date;
}

const MAX_ATTEMPTS_DEFAULT = 10;
const PULL_LIMIT_DEFAULT = 100;
const CONFLICT_VERSION_DELTA = 1;

const SYNC_ELIGIBLE_ENTITY_TYPES = [
  'ORDER',
  'PAYMENT',
  'CUSTOMER',
  'SHIFT',
  'CASH_ADJUSTMENT',
  'KITCHEN_ORDER',
  'TABLE_SESSION',
  'MENU_ITEM',
  'INVENTORY_TRANSACTION',
];

function toPlain<T extends { toObject?: () => unknown }>(doc: T | null | undefined): Record<string, unknown> | null {
  if (!doc) return null;
  if (typeof (doc as { toObject?: unknown }).toObject === 'function') {
    return (doc as { toObject: () => unknown }).toObject() as Record<string, unknown>;
  }
  return doc as unknown as Record<string, unknown>;
}

function toPlainOrUndef<T extends { toObject?: () => unknown }>(
  doc: T | null | undefined
): Record<string, unknown> | undefined {
  const plain = toPlain(doc);
  return plain === null ? undefined : plain;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly maxAttempts: number = MAX_ATTEMPTS_DEFAULT;

  constructor(
    @InjectModel(SyncRecord.name) private readonly syncRecordModel: Model<SyncRecord>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(CashAdjustment.name) private readonly cashAdjustmentModel: Model<CashAdjustment>,
    private readonly auditLogsService: AuditLogsService
  ) {}

  async applyBatch(
    ctx: AuthContext,
    deviceId: string,
    commands: SyncCommand[]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const cmd of commands) {
      try {
        const result = await this.applySingleCommand(ctx, deviceId, cmd);
        results.push(result);
      } catch (e) {
        this.logger.error(
          `Unexpected top-level error for key=${cmd.idempotencyKey}: ${(e as Error).message}`
        );
        results.push({
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId: cmd.entityId ?? null,
          status: 'FAILED',
          errorMessage: (e as Error).message,
          attemptCount: 1,
        });
      }
    }

    return results;
  }

  private async applySingleCommand(
    ctx: AuthContext,
    deviceId: string,
    cmd: SyncCommand
  ): Promise<SyncResult> {
    const branchId = ctx.branchId ?? (cmd.payload.branchId as string) ?? '';

    const existing = await this.syncRecordModel
      .findOne({ deviceId, idempotencyKey: cmd.idempotencyKey })
      .exec();

    if (existing) {
      if (existing.status === 'SUCCESS') {
        return {
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId: existing.entityId,
          status: 'SUCCESS',
          serverEntityVersion: existing.serverEntityVersion,
          serverSnapshot: (existing.responseSnapshot as Record<string, unknown> | undefined) ?? null,
          attemptCount: existing.attempts,
          appliedAt: existing.appliedAt,
        };
      }

      if (existing.status === 'FAILED' && existing.attempts >= this.maxAttempts) {
        return {
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId: existing.entityId,
          status: 'FAILED',
          errorMessage: `Max attempts (${this.maxAttempts}) exceeded. Last error: ${existing.lastError ?? 'unknown'}`,
          attemptCount: existing.attempts,
        };
      }
    }

    const attemptCount = existing ? existing.attempts + 1 : 1;
    const now = new Date();

    try {
      const applied = await this.applyCommand(ctx, cmd);

      if (
        applied.conflictDetected &&
        applied.serverVersion !== undefined &&
        cmd.localEntityVersion !== undefined &&
        applied.serverVersion > cmd.localEntityVersion + CONFLICT_VERSION_DELTA
      ) {
        await this.upsertSyncRecord(existing, {
          deviceId,
          branchId,
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId: cmd.entityId ?? ((applied.snapshot?._id as string) ?? ''),
          operation: cmd.operation,
          status: 'CONFLICT',
          conflictResolution: 'UNRESOLVED',
          attempts: attemptCount,
          lastAttemptAt: now,
          serverEntityVersion: applied.serverVersion,
          localEntityVersion: cmd.localEntityVersion,
          rawPayload: cmd.payload,
          responseSnapshot: applied.snapshot ?? undefined,
        });

        return {
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId: cmd.entityId ?? null,
          status: 'CONFLICT',
          serverEntityVersion: applied.serverVersion,
          conflictResolution: 'UNRESOLVED',
          serverSnapshot: applied.snapshot ?? null,
          attemptCount,
        };
      }

      await this.upsertSyncRecord(existing, {
        deviceId,
        branchId,
        idempotencyKey: cmd.idempotencyKey,
        entityType: cmd.entityType,
        entityId: applied.entityId ?? cmd.entityId ?? '',
        operation: cmd.operation,
        status: 'SUCCESS',
        attempts: attemptCount,
        lastAttemptAt: now,
        appliedAt: now,
        serverEntityVersion: applied.serverVersion,
        localEntityVersion: cmd.localEntityVersion,
        rawPayload: cmd.payload,
        responseSnapshot: applied.snapshot ?? undefined,
      });

      try {
        await this.auditLogsService.append({
          restaurantId: ctx.restaurantId,
          branchId,
          entityType: cmd.entityType,
          entityId: applied.entityId ?? cmd.entityId ?? null,
          action:
            cmd.operation === 'CREATE'
              ? S.AuditAction.CREATE
              : cmd.operation === 'DELETE'
              ? S.AuditAction.DELETE
              : S.AuditAction.UPDATE,
          performedBy: ctx.employeeId ?? ctx.userId,
          performedByRole: ctx.role,
          deviceId,
          metadata: { sync: true, idempotencyKey: cmd.idempotencyKey },
        });
      } catch (auditErr) {
        this.logger.warn(`Audit log failed for sync cmd: ${(auditErr as Error).message}`);
      }

      return {
        idempotencyKey: cmd.idempotencyKey,
        entityType: cmd.entityType,
        entityId: applied.entityId ?? cmd.entityId ?? null,
        status: 'SUCCESS',
        serverEntityVersion: applied.serverVersion,
        serverSnapshot: applied.snapshot ?? null,
        attemptCount,
        appliedAt: now,
      };
    } catch (e) {
      const errMsg = (e as Error).message;

      await this.upsertSyncRecord(existing, {
        deviceId,
        branchId,
        idempotencyKey: cmd.idempotencyKey,
        entityType: cmd.entityType,
        entityId: cmd.entityId ?? '',
        operation: cmd.operation,
        status: 'FAILED',
        attempts: attemptCount,
        lastAttemptAt: now,
        localEntityVersion: cmd.localEntityVersion,
        lastError: errMsg,
        rawPayload: cmd.payload,
      });

      return {
        idempotencyKey: cmd.idempotencyKey,
        entityType: cmd.entityType,
        entityId: cmd.entityId ?? null,
        status: 'FAILED',
        errorMessage: errMsg,
        attemptCount,
      };
    }
  }

  private async upsertSyncRecord(
    existing: SyncRecord | null,
    data: Partial<SyncRecord>
  ): Promise<SyncRecord> {
    if (existing) {
      return (await this.syncRecordModel
        .findByIdAndUpdate(existing._id, { $set: data }, { new: true })
        .exec()) as SyncRecord;
    }
    return (await this.syncRecordModel.create(data)) as SyncRecord;
  }

  private async applyCommand(
    ctx: AuthContext,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const branchId = ctx.branchId ?? (cmd.payload.branchId as string);
    const restaurantId = ctx.restaurantId ?? (cmd.payload.restaurantId as string);

    const entityTypeUpper = cmd.entityType.toUpperCase();

    switch (entityTypeUpper) {
      case 'ORDER':
        return this.applyOrderCommand(restaurantId, branchId, cmd);

      case 'PAYMENT':
        return this.applyPaymentCommand(restaurantId, branchId, cmd);

      case 'CUSTOMER':
        return this.applyCustomerCommand(restaurantId, branchId, cmd);

      case 'SHIFT':
        return this.applyShiftCommand(restaurantId, branchId, cmd);

      case 'CASH_ADJUSTMENT':
        return this.applyCashAdjustmentCommand(restaurantId, branchId, cmd);

      default:
        throw new Error(`Unsupported sync entityType: ${cmd.entityType}`);
    }
  }

  private async applyOrderCommand(
    restaurantId: string | undefined,
    branchId: string | undefined,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const payload = cmd.payload;

    if (!restaurantId || !branchId) {
      throw new Error('restaurantId and branchId required for ORDER sync');
    }

    if (cmd.operation === 'CREATE') {
      const employeeIdCandidate =
        typeof (payload as any).employeeId === 'string' ? String((payload as any).employeeId) : '';
      const shiftIdCandidate =
        typeof (payload as any).shiftId === 'string' ? String((payload as any).shiftId) : '';
      let resolvedShiftId = shiftIdCandidate || '';
      if (!resolvedShiftId && employeeIdCandidate) {
        const latestOpen = await this.shiftModel
          .findOne({
            employeeId: employeeIdCandidate,
            status: 'OPEN',
            branchId,
          })
          .sort({ openingTimestamp: -1 })
          .exec();
        if (latestOpen) resolvedShiftId = latestOpen._id.toString();
      }

      const createPayload = {
        restaurantId,
        branchId,
        ...payload,
        ...(resolvedShiftId ? { shiftId: resolvedShiftId } : {}),
      };
      const created = await this.orderModel.create(createPayload);

      const subtotal =
        typeof payload.subtotal === 'number' ? payload.subtotal : undefined;
      const discountAmount =
        typeof payload.discountAmount === 'number'
          ? payload.discountAmount
          : 0;
      const taxAmount =
        typeof payload.taxAmount === 'number' ? payload.taxAmount : 0;
      const totalAmount =
        typeof payload.totalAmount === 'number'
          ? payload.totalAmount
          : (subtotal ?? 0) - discountAmount + taxAmount;

      const serverCalcSubtotal = subtotal ?? 0;
      const serverCalcTotal = serverCalcSubtotal - discountAmount + taxAmount;
      if (typeof totalAmount === 'number' && Math.abs(totalAmount - serverCalcTotal) > 1) {
        this.logger.warn(
          `Order ${created._id} totals mismatch: client=${totalAmount} server-calc=${serverCalcTotal}`
        );
      }

      return {
        entityId: created._id.toString(),
        snapshot: toPlain(created),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    if (cmd.operation === 'UPDATE') {
      const entityId = cmd.entityId ?? (payload._id as string) ?? (payload.id as string);
      if (!entityId) throw new Error('UPDATE ORDER requires entityId');

      const existing = await this.orderModel.findById(entityId).exec();
      const serverVersion = 0;

      if (existing) {
        const updated = await this.orderModel
          .findByIdAndUpdate(entityId, { $set: payload }, { new: true })
          .exec();
        return {
          entityId,
          snapshot: toPlain(updated),
          serverVersion,
          conflictDetected: false,
        };
      }

      const upserted = await this.orderModel.create({
        _id: entityId,
        restaurantId,
        branchId,
        ...payload,
      });
      return {
        entityId,
        snapshot: toPlain(upserted),
        serverVersion,
        conflictDetected: false,
      };
    }

    if (cmd.operation === 'DELETE') {
      const entityId = cmd.entityId ?? (payload._id as string) ?? (payload.id as string);
      if (!entityId) throw new Error('DELETE ORDER requires entityId');
      const deleted = await this.orderModel.findByIdAndDelete(entityId).exec();
      return {
        entityId,
        snapshot: toPlain(deleted),
        serverVersion: undefined,
        conflictDetected: false,
      };
    }

    throw new Error(`Unknown operation for ORDER: ${cmd.operation}`);
  }

  private async applyPaymentCommand(
    restaurantId: string | undefined,
    branchId: string | undefined,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const payload = cmd.payload;

    if (!restaurantId || !branchId) {
      throw new Error('restaurantId and branchId required for PAYMENT sync');
    }

    const amountCents =
      typeof (payload as any).amountCents === 'number'
        ? Number((payload as any).amountCents)
        : typeof (payload as any).amount_cents === 'number'
          ? Number((payload as any).amount_cents)
          : typeof (payload as any).amount === 'number'
            ? Number((payload as any).amount)
            : 0;
    if (amountCents <= 0) {
      throw new Error(`Invalid payment amount: ${amountCents}`);
    }
    const orderId =
      (payload as any).orderId != null
        ? String((payload as any).orderId)
        : (payload as any).order_id != null
          ? String((payload as any).order_id)
          : '';
    const employeeId =
      (payload as any).employeeId != null
        ? String((payload as any).employeeId)
        : (payload as any).employee_id != null
          ? String((payload as any).employee_id)
          : '';
    let shiftId =
      (payload as any).shiftId != null
        ? String((payload as any).shiftId)
        : (payload as any).shift_id != null
          ? String((payload as any).shift_id)
          : '';
    if (!shiftId && employeeId) {
      const latestOpen = await this.shiftModel
        .findOne({
          employeeId,
          status: 'OPEN',
          branchId,
        })
        .sort({ openingTimestamp: -1 })
        .exec();
      if (latestOpen) shiftId = latestOpen._id.toString();
    }

    if (cmd.operation === 'CREATE') {
      const created = await this.paymentModel.create({
        restaurantId,
        branchId,
        ...(payload as any),
        ...(orderId ? { orderId } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(shiftId ? { shiftId } : {}),
        amountCents,
        completedAt:
          (payload as any).completedAt != null
            ? new Date((payload as any).completedAt)
            : (payload as any).completed_at != null
              ? new Date((payload as any).completed_at)
              : (payload as any).status === S.PaymentStatus.PAID
                ? new Date()
                : undefined,
      });

      if (orderId && created.status === S.PaymentStatus.PAID) {
        const realizedPayments = await this.paymentModel
          .find({
            orderId,
            status: { $in: [S.PaymentStatus.PAID, S.PaymentStatus.PENDING, S.PaymentStatus.PARTIALLY_PAID] },
          })
          .exec();
        const sum = realizedPayments.reduce((acc, p) => acc + (p.amountCents || 0), 0);
        const order = await this.orderModel.findById(orderId).exec();
        if (order) {
          const paymentStatus =
            sum >= order.totalCents
              ? S.PaymentStatus.PAID
              : sum > 0
                ? S.PaymentStatus.PARTIALLY_PAID
                : S.PaymentStatus.UNPAID;
          const patch: Record<string, unknown> = { paymentStatus };
          if (!order.shiftId && shiftId) patch.shiftId = shiftId;
          if (!order.employeeId && employeeId) patch.employeeId = employeeId;
          if (order.status === S.OrderStatus.AWAITING_PAYMENT && paymentStatus === S.PaymentStatus.PAID) {
            patch.status = S.OrderStatus.RECEIVED;
          }
          await this.orderModel.findByIdAndUpdate(order._id, { $set: patch }).exec();
        }
      }

      return {
        entityId: created._id.toString(),
        snapshot: toPlain(created),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    if (cmd.operation === 'UPDATE') {
      const entityId = cmd.entityId ?? (payload._id as string);
      if (!entityId) throw new Error('UPDATE PAYMENT requires entityId');

      const updated = await this.paymentModel
        .findByIdAndUpdate(entityId, { $set: payload }, { new: true })
        .exec();

      if (!updated) {
        const upserted = await this.paymentModel.create({
          _id: entityId,
          restaurantId,
          branchId,
          ...payload,
        });
        return {
          entityId,
          snapshot: toPlain(upserted),
          serverVersion: 0,
          conflictDetected: false,
        };
      }

      return {
        entityId,
        snapshot: toPlain(updated),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    throw new Error(`Unsupported operation for PAYMENT: ${cmd.operation}`);
  }

  private async applyCustomerCommand(
    restaurantId: string | undefined,
    branchId: string | undefined,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const payload = cmd.payload;

    if (!restaurantId) {
      throw new Error('restaurantId required for CUSTOMER sync');
    }

    if (cmd.operation === 'CREATE' || cmd.operation === 'UPDATE') {
      const entityId =
        cmd.entityId ??
        (payload._id as string) ??
        (payload.id as string);

      const query: Record<string, unknown> = { restaurantId };
      if (entityId) query._id = entityId;
      else if (payload.email) query.email = payload.email;
      else if (payload.phone) query.phone = payload.phone;

      const existing = await this.customerModel.findOne(query).exec();

      if (existing) {
        const updated = await this.customerModel
          .findByIdAndUpdate(
            existing._id,
            {
              $set: {
                ...payload,
                restaurantId,
                branchId: branchId ?? existing.branchId,
              },
            },
            { new: true }
          )
          .exec();
        return {
          entityId: existing._id.toString(),
          snapshot: toPlain(updated),
          serverVersion: 0,
          conflictDetected: false,
        };
      }

      const created = await this.customerModel.create({
        restaurantId,
        branchId,
        ...payload,
        totalVisits: (payload.totalVisits as number) ?? 0,
        totalSpent: (payload.totalSpent as number) ?? 0,
      });
      return {
        entityId: created._id.toString(),
        snapshot: toPlain(created),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    if (cmd.operation === 'DELETE') {
      const entityId = cmd.entityId;
      if (!entityId) throw new Error('DELETE CUSTOMER requires entityId');
      const deleted = await this.customerModel.findByIdAndDelete(entityId).exec();
      return {
        entityId,
        snapshot: toPlain(deleted),
        serverVersion: undefined,
        conflictDetected: false,
      };
    }

    throw new Error(`Unsupported operation for CUSTOMER: ${cmd.operation}`);
  }

  private async applyShiftCommand(
    restaurantId: string | undefined,
    branchId: string | undefined,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const payload = cmd.payload;

    if (!restaurantId || !branchId) {
      throw new Error('restaurantId and branchId required for SHIFT sync');
    }

    if (cmd.operation === 'CREATE' || cmd.operation === 'UPDATE') {
      const entityId =
        cmd.entityId ??
        (payload._id as string) ??
        (payload.id as string);

      if (entityId) {
        const existing = await this.shiftModel.findById(entityId).exec();
        if (existing) {
          const updated = await this.shiftModel
            .findByIdAndUpdate(entityId, { $set: payload }, { new: true })
            .exec();
          return {
            entityId,
            snapshot: toPlain(updated),
            serverVersion: 0,
            conflictDetected: false,
          };
        }
      }

      const created = await this.shiftModel.create({
        restaurantId,
        branchId,
        ...(entityId ? { _id: entityId } : {}),
        ...payload,
      });
      return {
        entityId: created._id.toString(),
        snapshot: toPlain(created),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    throw new Error(`Unsupported operation for SHIFT: ${cmd.operation}`);
  }

  private async applyCashAdjustmentCommand(
    restaurantId: string | undefined,
    branchId: string | undefined,
    cmd: SyncCommand
  ): Promise<{
    entityId: string | null;
    snapshot: Record<string, unknown> | null;
    serverVersion: number | undefined;
    conflictDetected: boolean;
  }> {
    const payload = cmd.payload;

    if (!branchId) {
      throw new Error('branchId required for CASH_ADJUSTMENT sync');
    }

    if (cmd.operation === 'CREATE') {
      const created = await this.cashAdjustmentModel.create({
        branchId,
        restaurantId,
        ...payload,
      });
      return {
        entityId: created._id.toString(),
        snapshot: toPlain(created),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    if (cmd.operation === 'UPDATE') {
      const entityId = cmd.entityId ?? (payload._id as string);
      if (!entityId) throw new Error('UPDATE CASH_ADJUSTMENT requires entityId');

      const updated = await this.cashAdjustmentModel
        .findByIdAndUpdate(entityId, { $set: { ...payload, branchId, restaurantId } }, { new: true })
        .exec();

      return {
        entityId,
        snapshot: toPlain(updated),
        serverVersion: 0,
        conflictDetected: false,
      };
    }

    throw new Error(`Unsupported operation for CASH_ADJUSTMENT: ${cmd.operation}`);
  }

  async pullUpdates(
    ctx: AuthContext,
    deviceId: string,
    opts: {
      cursor?: string;
      entityTypes?: string[];
      limit?: number;
      sinceDate?: Date;
    }
  ): Promise<{
    data: Array<{ entityType: string; entity: Record<string, unknown>; version: number }>;
    nextCursor: string | null;
    count: number;
    hasMore: boolean;
  }> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new Error('branchId required in auth context for pullUpdates');
    }

    const entityTypes = (
      opts.entityTypes && opts.entityTypes.length > 0
        ? opts.entityTypes
        : SYNC_ELIGIBLE_ENTITY_TYPES
    ).map((t) => t.toUpperCase());

    const limit = Math.min(
      opts.limit ?? PULL_LIMIT_DEFAULT,
      500
    );

    const sinceDate = opts.sinceDate
      ? opts.sinceDate
      : opts.cursor
      ? new Date(opts.cursor)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const results: Array<{
      entityType: string;
      entity: Record<string, unknown>;
      version: number;
    }> = [];

    const orderQuery: Record<string, unknown> = { branchId, updatedAt: { $gte: sinceDate } };
    if (opts.cursor) orderQuery._id = { $gt: opts.cursor };

    if (entityTypes.includes('ORDER')) {
      const orders = await this.orderModel
        .find(orderQuery)
        .sort({ _id: 1 })
        .limit(limit)
        .lean()
        .exec();
      for (const o of orders) {
        results.push({
          entityType: 'ORDER',
          entity: o as unknown as Record<string, unknown>,
          version: 0,
        });
      }
    }

    if (entityTypes.includes('PAYMENT')) {
      const payments = await this.paymentModel
        .find({ branchId, updatedAt: { $gte: sinceDate } })
        .sort({ _id: 1 })
        .limit(limit)
        .lean()
        .exec();
      for (const p of payments) {
        results.push({
          entityType: 'PAYMENT',
          entity: p as unknown as Record<string, unknown>,
          version: 0,
        });
      }
    }

    if (entityTypes.includes('CUSTOMER')) {
      const customers = await this.customerModel
        .find({
          $or: [{ restaurantId: ctx.restaurantId }, { branchId }],
          updatedAt: { $gte: sinceDate },
        })
        .sort({ _id: 1 })
        .limit(limit)
        .lean()
        .exec();
      for (const c of customers) {
        results.push({
          entityType: 'CUSTOMER',
          entity: c as unknown as Record<string, unknown>,
          version: 0,
        });
      }
    }

    if (entityTypes.includes('SHIFT')) {
      const shifts = await this.shiftModel
        .find({ branchId, updatedAt: { $gte: sinceDate } })
        .sort({ _id: 1 })
        .limit(limit)
        .lean()
        .exec();
      for (const s of shifts) {
        results.push({
          entityType: 'SHIFT',
          entity: s as unknown as Record<string, unknown>,
          version: 0,
        });
      }
    }

    if (entityTypes.includes('CASH_ADJUSTMENT')) {
      const adjustments = await this.cashAdjustmentModel
        .find({ branchId })
        .sort({ _id: 1 })
        .limit(limit)
        .lean()
        .exec();
      for (const a of adjustments) {
        results.push({
          entityType: 'CASH_ADJUSTMENT',
          entity: a as unknown as Record<string, unknown>,
          version: 0,
        });
      }
    }

    results.sort((a, b) => {
      const aUpd = (a.entity.updatedAt as Date) ?? new Date(0);
      const bUpd = (b.entity.updatedAt as Date) ?? new Date(0);
      return aUpd.getTime() - bUpd.getTime();
    });

    const limitedResults = results.slice(0, limit);
    const hasMore = results.length > limit;
    const nextCursor = hasMore && limitedResults.length > 0
      ? (limitedResults[limitedResults.length - 1].entity._id as string)
      : null;

    void deviceId;

    return {
      data: limitedResults,
      nextCursor,
      count: limitedResults.length,
      hasMore,
    };
  }
}
