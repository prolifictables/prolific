import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthContext } from '../decorators/current-user.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const decoded = this.jwtService.verify<AuthContext>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      });

      // Approval tokens have a scoped lifetime and use — allow short term
      if (decoded.tokenType === 'approval') {
        const age = Date.now() / 1000 - (decoded as unknown as { iat: number }).iat;
        if (age > 60) throw new UnauthorizedException('Approval token expired');
      }

      request.user = decoded;
      return true;
    } catch (err) {
      this.logger.debug(`JWT validation failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (header && header.startsWith('Bearer ')) return header.substring(7).trim();
    const cookie = (request as unknown as { cookies?: Record<string, string> }).cookies;
    if (cookie?.access_token) return cookie.access_token;
    return null;
  }
}
