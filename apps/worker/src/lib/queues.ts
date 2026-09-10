import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Queue topology — PRD Section 10.3. One queue per concern so a slow courier poll
 * cannot delay an order confirmation SMS.
 */

export const QUEUE_NAMES = {
  notifications: 'notifications',
  media: 'media',
  reports: 'reports',
  couriers: 'couriers',
  scheduling: 'scheduling',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  // BullMQ requires this: a blocking command must wait rather than fail fast.
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Keep enough history for Bull Board to be useful without growing Redis unbounded.
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 7 * 86_400 },
};

export const queues = {
  notifications: new Queue(QUEUE_NAMES.notifications, { connection, defaultJobOptions }),
  media: new Queue(QUEUE_NAMES.media, { connection, defaultJobOptions }),
  reports: new Queue(QUEUE_NAMES.reports, { connection, defaultJobOptions }),
  couriers: new Queue(QUEUE_NAMES.couriers, { connection, defaultJobOptions }),
  scheduling: new Queue(QUEUE_NAMES.scheduling, { connection, defaultJobOptions }),
  maintenance: new Queue(QUEUE_NAMES.maintenance, { connection, defaultJobOptions }),
} as const;

/**
 * Repeatable jobs. Registered with a fixed `jobId` so restarting the worker replaces
 * the schedule instead of stacking duplicates.
 */
export async function registerSchedules(): Promise<void> {
  await queues.reports.add(
    'daily-stats',
    {},
    // 00:20 Africa/Algiers, once the previous day is definitively closed.
    { repeat: { pattern: '20 0 * * *', tz: 'Africa/Algiers' }, jobId: 'daily-stats' },
  );

  await queues.scheduling.add(
    'apply-price-schedules',
    {},
    { repeat: { pattern: '*/10 * * * *' }, jobId: 'apply-price-schedules' },
  );

  await queues.scheduling.add(
    'detect-abandoned-carts',
    {},
    { repeat: { pattern: '*/15 * * * *' }, jobId: 'detect-abandoned-carts' },
  );

  await queues.scheduling.add(
    'low-stock-alerts',
    {},
    { repeat: { pattern: '0 9 * * *', tz: 'Africa/Algiers' }, jobId: 'low-stock-alerts' },
  );

  // Monthly, on the 1st: a series owes its occurrence for the month that just began.
  await queues.scheduling.add(
    'recurring-expenses',
    {},
    { repeat: { pattern: '10 1 1 * *', tz: 'Africa/Algiers' }, jobId: 'recurring-expenses' },
  );

  // 01:00, after the day is closed and before anyone reads a segment.
  await queues.scheduling.add(
    'segments',
    {},
    { repeat: { pattern: '0 1 * * *', tz: 'Africa/Algiers' }, jobId: 'segments' },
  );

  await queues.scheduling.add(
    'loyalty-expiry',
    {},
    { repeat: { pattern: '20 1 * * *', tz: 'Africa/Algiers' }, jobId: 'loyalty-expiry' },
  );

  await queues.maintenance.add(
    'backup',
    {},
    // 02:30 Africa/Algiers: after the daily stats rebuild, before anyone is working.
    { repeat: { pattern: '30 2 * * *', tz: 'Africa/Algiers' }, jobId: 'nightly-backup' },
  );

  await queues.couriers.add(
    'poll-tracking',
    {},
    { repeat: { pattern: '*/20 * * * *' }, jobId: 'poll-tracking' },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  await connection.quit();
}
