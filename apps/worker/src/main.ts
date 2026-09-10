// Must come first: it populates process.env before any other module reads it.
import './lib/env.js';
import { PrismaClient } from '@jecks/db';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { runBackup } from './jobs/backup.js';
import { pollCourierTracking } from './jobs/courier-sync.js';
import { dispatchNotification } from './notifications/dispatcher.js';
import { readSecret } from './lib/secrets.js';
import { rebuildDailyStats } from './jobs/daily-stats.js';
import { processMedia } from './jobs/media-process.js';
import {
  applyPriceSchedules,
  collectLowStockAlerts,
  detectAbandonedCarts,
} from './jobs/scheduling.js';
import { QUEUE_NAMES, closeQueues, connection, registerSchedules } from './lib/queues.js';
import { createStorage, storageConfigFromEnv } from '@jecks/storage';

/**
 * Background worker — PRD Section 10.3.
 *
 * Runs beside the API rather than inside it, so a heavy report cannot make a checkout
 * request wait. Every processor takes the Prisma client it is given, which is what
 * makes the job bodies unit-testable without Redis.
 */

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

const prisma = new PrismaClient();
const storage = createStorage(storageConfigFromEnv());

const workers: Worker[] = [];

/** The public storefront origin, used to build tracking links inside messages. */
function storefrontUrl(): string {
  return (process.env.STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function register(queue: string, handler: (job: Job) => Promise<unknown>, concurrency = 5): void {
  const worker = new Worker(
    queue,
    async (job) => {
      const started = Date.now();
      logger.info({ queue, job: job.name, id: job.id }, 'job started');
      const result = await handler(job);
      logger.info({ queue, job: job.name, id: job.id, ms: Date.now() - started, result }, 'job done');
      return result;
    },
    { connection, concurrency },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      { queue, job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: error.message },
      'job failed',
    );
  });

  workers.push(worker);
}

async function main(): Promise<void> {
  await prisma.$connect();

  register(QUEUE_NAMES.reports, async (job) => {
    if (job.name === 'daily-stats') {
      const days = (job.data as { days?: number }).days;
      return rebuildDailyStats(prisma, { days });
    }
    throw new Error(`Unknown reports job: ${job.name}`);
  }, 2);

  register(QUEUE_NAMES.scheduling, async (job) => {
    switch (job.name) {
      case 'apply-price-schedules':
        return applyPriceSchedules(prisma);
      case 'detect-abandoned-carts':
        return detectAbandonedCarts(prisma);
      case 'low-stock-alerts': {
        const alerts = await collectLowStockAlerts(prisma);
        for (const alert of alerts) {
          await dispatchNotification(
            { event: 'inventory.low', variantId: alert.variantId },
            {
              prisma,
              secret: (key) => readSecret(prisma, key),
              storefrontUrl: storefrontUrl(),
              log: (line) => logger.info({ notification: line }, 'notification'),
            },
          );
        }
        return { alerts: alerts.length };
      }
      default:
        throw new Error(`Unknown scheduling job: ${job.name}`);
    }
  });

  register(
    QUEUE_NAMES.notifications,
    async (job) => {
      if (job.name !== 'notification.dispatch' && job.name !== 'notification.send') {
        throw new Error(`Unknown notifications job: ${job.name}`);
      }
      return dispatchNotification(job.data as never, {
        prisma,
        secret: (key) => readSecret(prisma, key),
        storefrontUrl: storefrontUrl(),
        log: (line) => logger.info({ notification: line }, 'notification'),
      });
    },
    10,
  );

  register(
    QUEUE_NAMES.media,
    async (job) => {
      if (job.name !== 'media.process') throw new Error(`Unknown media job: ${job.name}`);
      const { mediaId } = job.data as { mediaId: string };
      return processMedia(prisma, storage, mediaId);
    },
    // Sharp releases the event loop but each rendition still costs CPU; three at a
    // time keeps a bulk gallery upload from starving the other queues.
    3,
  );

  register(
    QUEUE_NAMES.maintenance,
    async (job) => {
      if (job.name !== 'backup') throw new Error(`Unknown maintenance job: ${job.name}`);
      const { jobId } = job.data as { jobId?: string };
      return runBackup(prisma, storage, { jobId, retentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 14) });
    },
    // One dump at a time: two concurrent pg_dump runs on a single VPS is how a backup
    // takes the site down with it.
    1,
  );

  register(
    QUEUE_NAMES.couriers,
    async (job) => {
      if (job.name !== 'poll-tracking') throw new Error(`Unknown courier job: ${job.name}`);
      return pollCourierTracking({
        apiUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000/api/v1',
        token: process.env.INTERNAL_API_TOKEN,
        limit: Number(process.env.COURIER_SYNC_LIMIT ?? 200),
      });
    },
    2,
  );

  await registerSchedules();

  logger.info(
    { queues: Object.values(QUEUE_NAMES) },
    'worker ready',
  );
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  // Let in-flight jobs finish rather than leaving them stuck as active.
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error: unknown) => {
  logger.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
