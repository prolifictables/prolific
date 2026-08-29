import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'auditLogs', timestamps: false, autoIndex: true })
export class AuditLog
  extends Document
  implements Omit<S.AuditLog, 'id'>
{
  // restaurantId / branchId are not required at the MongoDB level because
  // audits can be emitted outside a scoped context (e.g. failed login before
  // a user is resolved, or cross-branch actions by a SUPER_ADMIN).
  @Prop({ type: String, required: false, index: true })
  restaurantId!: string | null;

  @Prop({ type: String, required: false, index: true })
  branchId!: string | null;

  @Prop({ type: String, required: true, index: true })
  entityType!: string;

  @Prop({ type: String, index: true })
  entityId?: string | null;

  @Prop({ type: String, required: true, enum: Object.values(S.AuditAction), index: true })
  action!: S.AuditAction;

  @Prop({ type: String, required: true, index: true })
  performedBy!: string;

  @Prop({ type: String, required: true, enum: Object.values(S.Role) })
  performedByRole!: S.Role;

  @Prop({ type: String, index: true })
  deviceId?: string | null;

  @Prop({ type: Date, required: true, index: true })
  timestamp!: Date;

  @Prop({ type: String })
  ipAddress?: string | null;

  @Prop({ type: Array, default: undefined })
  changes?: { field: string; oldValue?: unknown; newValue?: unknown }[];

  @Prop({ type: Object, default: undefined })
  metadata?: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ branchId: 1, timestamp: -1 });
AuditLogSchema.index({ performedBy: 1, timestamp: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });
