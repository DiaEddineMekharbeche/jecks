import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { REPORT_KEYS, type ReportExportRequest, type ReportKey } from '@jecks/shared';
import { ExportService } from '../../common/list/export.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ReportsService, exportBaseName } from './reports.service.js';

/**
 * Report exports that nobody waits for — PRD Section 5.9 and M7.
 *
 * The download on the reports screen streams straight back, which is right for the
 * hundred rows somebody is looking at. It is wrong for a year of order lines: the
 * browser holds a connection open for a minute, a proxy times it out at thirty seconds,
 * and the accountant learns this at the end rather than the beginning.
 *
 * So a large export becomes a job. The row appears immediately, the worker picks it up,
 * and the file lands in storage with a link. The clock and the retry belong to the
 * worker; the query belongs here, because this is where the report lives.
 */

const JOB_QUEUE = 'reports';
const JOB_NAME = 'report.export';

/** Far above what the interactive path returns, and still a number, not "everything". */
const MAX_ROWS = 100_000;

export interface ReportExportRow {
  id: string;
  key: string;
  title: string;
  format: 'csv' | 'xlsx';
  from: string | null;
  to: string | null;
  status: 'queued' | 'running' | 'ready' | 'failed';
  rows: number | null;
  error: string | null;
  createdAt: string;
  downloadUrl: string | null;
}

interface ExportPayload {
  key: ReportKey;
  format: 'csv' | 'xlsx';
  from?: string;
  to?: string;
  requestedBy: string | null;
}

@Injectable()
export class ReportExportsService {
  private readonly logger = new Logger(ReportExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
  ) {}

  async list(limit = 50): Promise<ReportExportRow[]> {
    const rows = await this.prisma.job.findMany({
      where: { queue: JOB_QUEUE, name: JOB_NAME },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => this.toRow(row));
  }

  async get(id: string): Promise<ReportExportRow> {
    const row = await this.prisma.job.findUnique({ where: { id } });
    if (!row || row.name !== JOB_NAME) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Export introuvable' });
    }
    return this.toRow(row);
  }

  /**
   * Queues one. Returns straight away with a `queued` row, so the screen can show it
   * before the worker has looked at Redis.
   */
  async queueExport(
    key: ReportKey,
    query: ReportExportRequest,
    actorId: string | null,
  ): Promise<ReportExportRow> {
    const payload: ExportPayload = {
      key,
      format: query.format,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      requestedBy: actorId,
    };

    const job = await this.prisma.job.create({
      data: { queue: JOB_QUEUE, name: JOB_NAME, status: 'queued', payload: { ...payload } },
    });

    const enqueued = await this.queue.enqueue(JOB_QUEUE, JOB_NAME, { jobId: job.id });

    if (!enqueued) {
      // Redis down must not leave a row that says "queued" for ever. Better to say it
      // failed now than to have somebody wait for a file that is not coming.
      const failed = await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: "La file d'attente est injoignable ; réessayez quand Redis est revenu.",
          finishedAt: new Date(),
        },
      });
      return this.toRow(failed);
    }

    return this.toRow(job);
  }

  /**
   * Runs one, called by the worker through the internal route.
   *
   * Everything is caught: a job that throws here would be retried by BullMQ against a
   * report that will fail the same way three more times, and the operator would see a
   * row stuck on "running" throughout.
   */
  async run(jobId: string): Promise<{ rows: number; key: string }> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.name !== JOB_NAME) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Export introuvable' });
    }

    const payload = job.payload as unknown as ExportPayload;
    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
    });

    try {
      if (!(REPORT_KEYS as readonly string[]).includes(payload.key)) {
        throw new Error(`Rapport inconnu : ${payload.key}`);
      }

      const result = await this.reports.run(payload.key, {
        from: payload.from ? new Date(payload.from) : undefined,
        to: payload.to ? new Date(payload.to) : undefined,
        limit: MAX_ROWS,
      });

      // The columns come from the report, so a report added later exports with no
      // change here — the same contract the interactive download uses.
      const columns = result.columns.map((column) => ({
        header: column.label,
        value: (row: Record<string, string | number | null>) => row[column.key] ?? '',
      }));

      const buffer = await this.exporter.toBuffer(payload.format, columns, result.rows);
      const key = `exports/${exportBaseName(payload.key)}-${stamp()}-${jobId.slice(0, 8)}.${payload.format}`;
      await this.storage.put(key, buffer);

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          error: null,
          result: {
            key,
            rows: result.rows.length,
            sizeBytes: buffer.length,
            title: result.title,
            truncated: result.rows.length >= MAX_ROWS,
          },
        },
      });

      return { rows: result.rows.length, key };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Export ${jobId} failed: ${message}`);

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finishedAt: new Date(), error: message.slice(0, 500) },
      });

      throw error;
    }
  }

  private toRow(job: {
    id: string;
    status: string;
    payload: unknown;
    result: unknown;
    error: string | null;
    createdAt: Date;
  }): ReportExportRow {
    const payload = (job.payload ?? {}) as Partial<ExportPayload>;
    const result = (job.result ?? {}) as { key?: string; rows?: number; title?: string };
    const status = mapStatus(job.status);

    return {
      id: job.id,
      key: payload.key ?? '',
      title: result.title ?? payload.key ?? '',
      format: payload.format ?? 'csv',
      from: payload.from?.slice(0, 10) ?? null,
      to: payload.to?.slice(0, 10) ?? null,
      status,
      rows: result.rows ?? null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      downloadUrl: status === 'ready' && result.key ? this.storage.publicUrl(result.key) : null,
    };
  }
}

function mapStatus(status: string): ReportExportRow['status'] {
  if (status === 'completed' || status === 'succeeded') return 'ready';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'queued';
}

/** `2026-09-11-0542`, so two exports of the same report in a day do not collide. */
function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
}
