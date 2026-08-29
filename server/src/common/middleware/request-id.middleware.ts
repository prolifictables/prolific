import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export class RequestIdMiddleware {
  static readonly HEADER = 'X-Request-Id';

  static use(req: Request, res: Response, next: NextFunction) {
    const existing = String(req.header(RequestIdMiddleware.HEADER) || '').trim();
    const id = existing || randomUUID();
    req.headers[RequestIdMiddleware.HEADER.toLowerCase()] = id;
    res.setHeader(RequestIdMiddleware.HEADER, id);
    next();
  }
}
