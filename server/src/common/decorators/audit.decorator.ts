import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@prolific/shared-types';

export const AUDIT_METADATA_KEY = 'audit_action';

export interface AuditMetadata {
  action: AuditAction;
  entityType: string;
  /** Extract entity id from a route param (e.g. "id") or a function called on req */
  entityIdParam?: string;
  /** Log field diffs? (for UPDATE actions) */
  captureChanges?: boolean;
}

/**
 * Placed on a controller handler to mark it as audit-logged.
 * AuditInterceptor writes the row after a successful 2xx response.
 */
export const Audit = (meta: AuditMetadata) => SetMetadata(AUDIT_METADATA_KEY, meta);
