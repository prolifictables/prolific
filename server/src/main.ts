import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

const WEBHOOK_PATH_RE = /\/payments\/webhook\/(paystack|flutterwave)$/;

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const corsOriginEnv = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    cors: {
      origin: corsOriginEnv
        ? (origin, cb) => {
            if (!origin) return cb(null, true);
            if (corsOriginEnv.includes(origin)) return cb(null, true);
            if (/^https?:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
            if (/^https?:\/\/127\.0\.0\.1:\d+$/.test(origin)) return cb(null, true);
            return cb(null, false);
          }
        : true,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Idempotency-Key',
        'X-Request-Id',
        'X-Branch-Id',
      ],
    },
    bodyParser: false,
  });

  app.use((req: any, _res: any, next: any) => {
    const url: string = req.url || req.path || '';
    if (WEBHOOK_PATH_RE.test(url)) {
      bodyParser.raw({ type: '*/*' })(req, _res, () => {
        if (req.body instanceof Buffer) {
          req.rawBody = req.body.toString('utf-8');
        } else if (typeof req.body === 'string') {
          req.rawBody = req.body;
        }
        next();
      });
    } else {
      bodyParser.json({ limit: '10mb' })(req, _res, () => {
        if (req.body && typeof req.body === 'object') {
          req.rawBody = JSON.stringify(req.body);
        }
        next();
      });
    }
  });

  // Security: standard headers + disable powered-by
  app.use(helmet());
  const httpServer = app.getHttpAdapter().getInstance();
  if (typeof (httpServer as any).disable === 'function') {
    (httpServer as any).disable('x-powered-by');
  }

  // Global request id injection
  app.use(RequestIdMiddleware.use);

  // Global validation pipe — transforms + strips unknown fields
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    })
  );

  // Global error envelope filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Server ready on http://0.0.0.0:${port}/api/v1`);
  logger.log(`GraphQL (if any) disabled for Phase 1.`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap failure:', err);
  process.exit(1);
});
