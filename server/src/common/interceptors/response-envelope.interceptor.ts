import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RequestIdMiddleware } from '../middleware/request-id.middleware';

export interface ResponseEnvelope<T> {
  success: boolean;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    cursor?: string | null;
    count?: number | null;
    totalCount?: number | null;
    hasMore?: boolean;
    [k: string]: unknown;
  };
}

@Injectable()
export class ResponseEnvelopeInterceptor<T = unknown>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ResponseEnvelope<T>> {
    const request = context.switchToHttp().getRequest();
    const requestId = String(
      request.headers[RequestIdMiddleware.HEADER.toLowerCase()] || ''
    );
    const timestamp = new Date().toISOString();

    return next.handle().pipe(
      map((body: unknown) => {
        const alreadyShaped =
          body &&
          typeof body === 'object' &&
          'success' in (body as object) &&
          'data' in (body as object);

        if (alreadyShaped) {
          const b = body as ResponseEnvelope<T>;
          const customMeta: Record<string, unknown> = b.meta
            ? { ...(b.meta as Record<string, unknown>) }
            : {};
          // Explicitly ensure requestId/timestamp take precedence over duplicates.
          delete customMeta.requestId;
          delete customMeta.timestamp;
          return {
            success: true,
            data: b.data ?? null,
            meta: {
              ...customMeta,
              requestId,
              timestamp,
            },
            error: null,
          } as unknown as ResponseEnvelope<T>;
        }

        return {
          success: true,
          data: (body ?? null) as T,
          meta: {
            requestId,
            timestamp,
          },
        };
      })
    );
  }
}
