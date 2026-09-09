// Must come first: it populates process.env before any other module reads it.
import './lib/env.js';
import { PrismaClient } from '@jecks/db';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
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
        // TODO(M4): hand these to the Notifier interface of PRD Section 6.1.
        if (alerts.length > 0) logger.warn({ count: alerts.length }, 'low stock');
        return { alerts: alerts.length };
      }
      default:
        throw new Error(`Unknown scheduling job: ${job.name}`);
    }
  });

  register(QUEUE_NAMES.notifications, async (job) => {
    // The SMS, e-mail and WhatsApp adapters land with M3 (PRD Section 6.1). Until then
    // the queue is real and the payload is logged, so the wiring is exercised.
    logger.info({ payload: job.data }, 'notification (log adapter)');
    return { delivered: false, adapter: 'log' };
  }, 10);

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

  register(QUEUE_NAMES.couriers, async (job) => {
    // Tracking polling needs a live courier adapter, which arrives in M4 (F-AD-61).
    logger.info({ job: job.name }, 'courier sync queued, adapters pending M4');
    return { polled: 0 };
  }, 2);

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
