import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT_API: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('14d'),
  ENCRYPTION_MASTER_KEY: z
    .string()
    .min(16, 'ENCRYPTION_MASTER_KEY must be set (32 bytes base64 recommended)'),
  AUDIT_HASH_PEPPER: z.string().min(8, 'AUDIT_HASH_PEPPER must be set').default('dev-pepper'),
  SUPER_ADMIN_BOOTSTRAP_EMAIL: z.string().email().default('superadmin@quantumed.local'),
  DEMO_HOSPITAL_SLUG: z.string().min(1).default('demo'),
});

export function configValidation(config: Record<string, unknown>) {
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return parsed.data;
}
