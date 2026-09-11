import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

/**
 * What the queues are doing — PRD Section 10.3, and M7's "Bull Board under admin auth".
 *
 * Bull Board is a separate application mounted inside this one, with its own auth story
 * and its own dependency tree. The thing an operator actually needs from it is four
 * numbers per queue and the last few failures, and BullMQ stores those in Redis keys
 * with a documented layout, so that is what this reads.
 *
 * The result is one screen behind the same permission as everything else, rather than a
 * second application to secure.
 */

export const QUEUE_NAMES = [
  'notifications',
  'media',
  'reports',
  'couriers',
  'scheduling',
  'maintenance',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueCounts {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  /** Repeatable job definitions registered against this queue. */
  scheduled: number;
}

export interface FailedJob {
  queue: QueueName;
  id: string;
  name: string;
  reason: string;
  attempts: number;
  failedAt: string | null;
}

@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly logger = new Logger(QueuesService.name);
  private readonly redis: IORedis | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');

    this.redis = url
      ? new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true })
      : null;

    this.redis?.on('error', (error) => {
      this.logger.debug(`Queue inspection unavailable: ${error.message}`);
    });

    void this.redis?.connect().catch(() => undefined);
  }

  /**
   * Counts per queue.
   *
   * Returns zeros rather than failing when Redis is unreachable: the screen should say
   * the queues are empty and unreachable, not refuse to render.
   */
  async counts(): Promise<{ reachable: boolean; queues: QueueCounts[] }> {
    if (!this.redis) {
      return { reachable: false, queues: QUEUE_NAMES.map(emptyCounts) };
    }

    try {
      const queues = await Promise.all(QUEUE_NAMES.map((name) => this.countsFor(name)));
      return { reachable: true, queues };
    } catch (error) {
      this.logger.warn(`Could not read queue counts: ${(error as Error).message}`);
      return { reachable: false, queues: QUEUE_NAMES.map(emptyCounts) };
    }
  }

  private async countsFor(name: QueueName): Promise<QueueCounts> {
    const prefix = `bull:${name}`;

    // BullMQ keeps waiting and active as lists, the finished sets as sorted sets, and
    // the repeatable definitions in their own sorted set.
    const [waiting, active, completed, failed, delayed, scheduled] = await Promise.all([
      this.redis!.llen(`${prefix}:wait`),
      this.redis!.llen(`${prefix}:active`),
      this.redis!.zcard(`${prefix}:completed`),
      this.redis!.zcard(`${prefix}:failed`),
      this.redis!.zcard(`${prefix}:delayed`),
      this.redis!.zcard(`${prefix}:repeat`),
    ]);

    return { name, waiting, active, completed, failed, delayed, scheduled };
  }

  /**
   * The most recent failures across every queue.
   *
   * This is the whole reason to look at a queue dashboard: not how many succeeded, but
   * what stopped and why.
   */
  async failures(limit = 25): Promise<FailedJob[]> {
    if (!this.redis) return [];

    const jobs: FailedJob[] = [];

    try {
      for (const name of QUEUE_NAMES) {
        const ids = await this.redis.zrevrange(`bull:${name}:failed`, 0, limit - 1);

        for (const id of ids) {
          const data = await this.redis.hmget(
            `bull:${name}:${id}`,
            'name',
            'failedReason',
            'attemptsMade',
            'finishedOn',
          );

          jobs.push({
            queue: name,
            id,
            name: data[0] ?? 'unknown',
            // Trimmed: a stack trace belongs in the log, not in a table cell.
            reason: (data[1] ?? 'no reason recorded').slice(0, 300),
            attempts: Number(data[2] ?? 0),
            failedAt: data[3] ? new Date(Number(data[3])).toISOString() : null,
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Could not read failed jobs: ${(error as Error).message}`);
    }

    return jobs
      .sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''))
      .slice(0, limit);
  }

  /**
   * Puts a failed job back on its queue.
   *
   * Moving the id from the failed set to the waiting list is what a retry is; the job
   * payload is already stored and the worker picks it up on its next poll.
   */
  async retry(queue: QueueName, jobId: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const removed = await this.redis.zrem(`bull:${queue}:failed`, jobId);
      if (removed === 0) return false;

      await this.redis.hset(`bull:${queue}:${jobId}`, 'failedReason', '', 'finishedOn', '');
      await this.redis.lpush(`bull:${queue}:wait`, jobId);
      return true;
    } catch (error) {
      this.logger.warn(`Could not retry ${queue}/${jobId}: ${(error as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}

function emptyCounts(name: QueueName): QueueCounts {
  return { name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, scheduled: 0 };
}
