import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestIdMiddleware } from '../middleware/request-id.middleware';
import { ZodError } from 'zod';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = String(
      request.headers[RequestIdMiddleware.HEADER.toLowerCase()] || ''
    );

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as { error?: string; message?: unknown; code?: string };
        code = r.code ?? (r.error || HttpStatus[status] || 'HTTP_ERROR');
        message = Array.isArray(r.message) ? r.message.join('; ') : String(r.message || exception.message);
        details = Array.isArray(r.message) ? r.message : undefined;
      } else {
        message = typeof resp === 'string' ? resp : exception.message;
        code = HttpStatus[status] || 'HTTP_ERROR';
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = exception.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled exception at ${request.method} ${request.url}: ${exception.stack || exception.message}`
      );
    } else {
      this.logger.error(
        `Unknown exception at ${request.method} ${request.url}: ${String(exception)}`
      );
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} → ${status} ${code}: ${message}`
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} → ${status} ${code}: ${message}`
      );
    }

    response.status(status).json({
      success: false,
      data: null,
      error: {
        code,
        message,
        details,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
