import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { Env } from '../../config/env.js';

/**
 * Producer side of the job queues — PRD Section 10.3.
 *
 * The API only ever enqueues; the worker consumes. Queue names and job names are shared
 * with `apps/worker/src/lib/queues.ts` through this list, so a rename shows up as a
 * type error rather than as jobs quietly falling into a queue nobody reads.
 */

export const QUEUES = {
  notifications: 'notifications',
  media: 'media',
  reports: 'reports',
  couriers: 'couriers',
  scheduling: 'scheduling',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MediaProcessJob {
  mediaId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: IORedis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(config: ConfigService<Env, true>) {
    this.connection = new IORedis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // The API must start even when Redis is down; enqueues then fail individually
      // rather than taking the whole process with them.
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
    });

    this.connection.on('error', (error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  private queue(name: QueueName): Queue {
    let existing = this.queues.get(name);
    if (!existing) {
      existing = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 3_600, count: 500 },
          removeOnFail: { age: 7 * 86_400 },
        },
      });
      this.queues.set(name, existing);
    }
    return existing;
  }

  /**
   * Enqueues a job, and never throws. A failed enqueue is logged and the caller
   * continues: an upload that succeeded must not be reported as failed because the
   * follow-up processing could not be scheduled.
   */
  async enqueue(
    name: QueueName,
    jobName: string,
    payload: unknown,
    options?: JobsOptions,
  ): Promise<string | null> {
    try {
      const job = await this.queue(name).add(jobName, payload, options);
      return job.id ?? null;
    } catch (error) {
      this.logger.error(
        `Could not enqueue ${name}:${jobName} — ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * No fixed `jobId` here. BullMQ deduplicates on it and keeps completed and failed
   * jobs for a while, so a stable id makes a file impossible to reprocess after it
   * fails once — which is precisely when reprocessing matters. Running twice is
   * harmless instead: renditions are content-addressed and simply overwrite.
   */
  async processMedia(mediaId: string): Promise<void> {
    await this.enqueue(QUEUES.media, 'media.process', { mediaId } satisfies MediaProcessJob);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
  }
}
