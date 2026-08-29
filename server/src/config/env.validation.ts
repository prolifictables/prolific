import { z } from 'zod';

export const EnvValidationSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  JWT_ISSUER: z.string().default('prolific.pos'),
  JWT_AUDIENCE: z.string().default('prolific.clients'),

  CORS_ORIGIN: z.string().optional(),

  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().optional(),
  SEED_SUPERADMIN_FIRSTNAME: z.string().optional(),
  SEED_SUPERADMIN_LASTNAME: z.string().optional(),
  SEED_ENABLED: z.enum(['true','false']).default('false'),
  SEED_RUN_ONCE: z.enum(['true','false']).default('true'),
  DEFAULT_PAYMENT_PROVIDER: z.enum(['PAYSTACK','FLUTTERWAVE','TEST','NONE']).default('TEST'),

  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(500),
});
