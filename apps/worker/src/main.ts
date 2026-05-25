/**
 * QuantuMed background worker.
 *
 * Phase A scope: scaffold a single BullMQ worker that drains a default queue and
 * logs jobs. The real domain queues (notifications, billing reconciliation,
 * teleradiology pre-processing, audit chain verification, etc.) land in Phase
 * B+ — each as its own dedicated worker module.
 */
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

const logger = pino({ name: 'quantumed-worker' });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(8),
});

export const QUEUE_NAME = 'quantumed.default';

export interface DefaultJob {
  kind: 'noop' | 'echo';
  payload?: Record<string, unknown>;
}

async function bootstrap(): Promise<void> {
  const env = EnvSchema.parse(process.env);

  const connection: ConnectionOptions = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<DefaultJob>(QUEUE_NAME, { connection });
  logger.info({ queue: QUEUE_NAME }, 'queue ready');

  const worker = new Worker<DefaultJob>(
    QUEUE_NAME,
    async (job: Job<DefaultJob>) => {
      logger.info({ id: job.id, kind: job.data.kind }, 'processing job');
      if (job.data.kind === 'echo') return job.data.payload ?? null;
      return null;
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on('completed', (job) => logger.info({ id: job.id }, 'job completed'));
  worker.on('failed', (job, err) => logger.error({ id: job?.id, err: err.message }, 'job failed'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');
}

void bootstrap().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'worker bootstrap failed');
  process.exit(1);
});
