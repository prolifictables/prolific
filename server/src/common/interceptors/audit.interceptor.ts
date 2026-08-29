import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AUDIT_METADATA_KEY, AuditMetadata } from '../decorators/audit.decorator';
import type { AuthContext } from '../decorators/current-user.decorator';
import { RequestIdMiddleware } from '../middleware/request-id.middleware';
import { AuditLogsService } from '../../audit/audit-logs.service';
import * as S from '@prolific/shared-types';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditLogsService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata>(
      AUDIT_METADATA_KEY,
      context.getHandler()
    );
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthContext | undefined;
    const requestId = String(
      request.headers[RequestIdMiddleware.HEADER.toLowerCase()] || ''
    );

    const oldValue: unknown = request.body
      ? JSON.parse(JSON.stringify(request.body))
      : null;

    const finalize = async (
      status: 'success' | 'error',
      newValue?: unknown,
      error?: Error
    ) => {
      try {
        let entityId = meta.entityIdParam
          ? request.params[meta.entityIdParam]
          : undefined;
        if (!entityId && newValue && typeof newValue === 'object') {
          const nv = newValue as { id?: string; _id?: string };
          entityId = nv.id || nv._id?.toString();
        }

        const changes =
          meta.captureChanges &&
          oldValue &&
          newValue &&
          typeof oldValue === 'object' &&
          typeof newValue === 'object'
            ? this.diff(
                oldValue as Record<string, unknown>,
                newValue as Record<string, unknown>
              )
            : undefined;

        await this.auditService.append({
          restaurantId: user?.restaurantId ?? null,
          branchId: user?.branchId ?? null,
          entityType: meta.entityType,
          entityId: entityId ?? null,
          action: meta.action,
          performedBy: user?.employeeId ?? user?.userId ?? 'system',
          performedByRole: user?.role ?? S.Role.SUPER_ADMIN,
          deviceId: (request.headers['x-device-id'] as string) ?? null,
          timestamp: new Date(),
          ipAddress: request.ip ?? null,
          changes,
          metadata: {
            requestId,
            status,
            errorMessage: error?.message ?? undefined,
          },
        });
      } catch (e) {
        this.logger.error(`Audit log append failed: ${(e as Error).message}`);
      }
    };

    return next.handle().pipe(
      tap((value) => {
        setImmediate(() => finalize('success', value));
      }),
      catchError((err) => {
        setImmediate(() => finalize('error', undefined, err as Error));
        return throwError(() => err);
      })
    );
  }

  private diff(a: Record<string, unknown>, b: Record<string, unknown>) {
    const changes: { field: string; oldValue?: unknown; newValue?: unknown }[] = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        changes.push({ field: k, oldValue: a[k], newValue: b[k] });
      }
    }
    return changes.length ? changes : undefined;
  }
}

