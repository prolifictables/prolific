import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuditLog as IAuditLog, Role, AuditAction } from '@prolific/shared-types';
import { AuditLog } from './schemas/audit-log.schema';

export type AppendAuditParams = {
  restaurantId: string | null;
  branchId: string | null;
  entityType: string;
  entityId: string | null;
  action: AuditAction;
  performedBy: string;
  performedByRole: Role | 'SUPER_ADMIN';
  deviceId?: string | null;
  timestamp?: Date;
  ipAddress?: string | null;
  changes?: { field: string; oldValue?: unknown; newValue?: unknown }[];
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>
  ) {}

  async append(params: AppendAuditParams): Promise<IAuditLog | null> {
    try {
      const created = await this.auditModel.create({
        restaurantId: params.restaurantId ?? null,
        branchId: params.branchId ?? null,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        action: params.action,
        performedBy: params.performedBy,
        performedByRole: params.performedByRole,
        deviceId: params.deviceId ?? null,
        timestamp: params.timestamp ?? new Date(),
        ipAddress: params.ipAddress ?? null,
        changes: params.changes,
        metadata: params.metadata ?? undefined,
      });
      return created as unknown as IAuditLog;
    } catch (err) {
      // Never let audit logging kill the request
      this.logger.error(`Audit append failed: ${(err as Error).message}`);
      return null;
    }
  }

  async find(filters: {
    branchId?: string;
    restaurantId?: string;
    entityType?: string;
    entityId?: string;
    performedBy?: string;
    action?: AuditAction;
    limit?: number;
    cursor?: string;
  }) {
    const q: Record<string, unknown> = {};
    if (filters.branchId) q.branchId = filters.branchId;
    if (filters.restaurantId) q.restaurantId = filters.restaurantId;
    if (filters.entityType) q.entityType = filters.entityType;
    if (filters.entityId) q.entityId = filters.entityId;
    if (filters.performedBy) q.performedBy = filters.performedBy;
    if (filters.action) q.action = filters.action;

    const limit = Math.min(filters.limit ?? 100, 500);
    if (filters.cursor) {
      q.timestamp = { $lt: new Date(filters.cursor) };
    }

    const rows = await this.auditModel
      .find(q)
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
    const next = rows.length === limit ? rows[rows.length - 1].timestamp.toISOString() : null;
    return { rows, nextCursor: next };
  }
}
