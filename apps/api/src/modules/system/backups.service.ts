import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackupRow } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Database backups — PRD F-AD-91 and Section 10.10.
 *
 * The API never runs `pg_dump` itself. It enqueues a `backup` job and reports on the
 * `Job` rows the worker writes, because a dump of a real catalogue takes minutes and an
 * HTTP request that waits for one is a request that times out.
 *
 * Retention is enforced by the worker; this service is the read side plus the trigger.
 */

const JOB_QUEUE = 'maintenance';
const JOB_NAME = 'backup';

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async list(): Promise<BackupRow[]> {
    const rows = await this.prisma.job.findMany({
      where: { queue: JOB_QUEUE, name: JOB_NAME },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((row) => {
      const result = (row.result ?? {}) as { key?: string; sizeBytes?: number };
      const status = mapStatus(row.status);
      return {
        id: row.id,
        key: result.key ?? '',
        sizeBytes: Number(result.sizeBytes ?? 0),
        status,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        downloadUrl: status === 'ready' && result.key ? this.storage.publicUrl(result.key) : null,
      };
    });
  }

  /**
   * Queues a dump. Returns immediately with a `running` row so the screen can show it
   * before the worker has picked it up.
   */
  async trigger(actorId: string | null): Promise<BackupRow> {
    const job = await this.prisma.job.create({
      data: {
        queue: JOB_QUEUE,
        name: JOB_NAME,
        status: 'queued',
        payload: { requestedBy: actorId, databaseUrlPresent: Boolean(this.config.get('DATABASE_URL')) },
      },
    });

    try {
      await this.queue.enqueue(JOB_QUEUE, JOB_NAME, { jobId: job.id, requestedBy: actorId });
    } catch (error) {
      // Redis being down must not leave a row claiming a backup is running forever.
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'failed', error: String(error), finishedAt: new Date() },
      });
      this.logger.error(`Could not queue a backup: ${String(error)}`);
    }

    const rows = await this.list();
    const row = rows.find((item) => item.id === job.id);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Backup not found' });
    return row;
  }

  async get(id: string): Promise<BackupRow> {
    const rows = await this.list();
    const row = rows.find((item) => item.id === id);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Backup not found' });
    return row;
  }
}

function mapStatus(status: string): BackupRow['status'] {
  if (status === 'completed' || status === 'succeeded') return 'ready';
  if (status === 'failed') return 'failed';
  return 'running';
}
