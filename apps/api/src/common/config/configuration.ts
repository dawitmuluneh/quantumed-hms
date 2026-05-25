/**
 * Centralised runtime configuration. Read by `ConfigService` everywhere; never
 * read `process.env` directly from feature code.
 */
export const configuration = () => ({
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT_API: Number(process.env.PORT_API ?? 4000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',

  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? '',

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? '',
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '15m',
  JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL ?? '14d',

  ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY ?? '',
  AUDIT_HASH_PEPPER: process.env.AUDIT_HASH_PEPPER ?? '',

  SUPER_ADMIN_BOOTSTRAP_EMAIL:
    process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL ?? 'superadmin@quantumed.local',
  SUPER_ADMIN_BOOTSTRAP_PASSWORD: process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD ?? '',
  DEMO_HOSPITAL_SLUG: process.env.DEMO_HOSPITAL_SLUG ?? 'demo',

  STRIPE_API_KEY: process.env.STRIPE_API_KEY ?? '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  JITSI_DOMAIN: process.env.JITSI_DOMAIN ?? 'meet.jit.si',
  JITSI_APP_ID: process.env.JITSI_APP_ID ?? '',
  JITSI_JWT_SECRET: process.env.JITSI_JWT_SECRET ?? '',
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'stub',
  SMTP_URL: process.env.SMTP_URL ?? '',
  SMTP_FROM: process.env.SMTP_FROM ?? 'no-reply@quantumed.local',
  AI_TRIAGE_PROVIDER: process.env.AI_TRIAGE_PROVIDER ?? 'stub',
});

export type AppConfig = ReturnType<typeof configuration>;
