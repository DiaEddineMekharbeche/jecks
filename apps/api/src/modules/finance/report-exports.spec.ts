import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportExportsService } from './report-exports.service.js';

/**
 * Queued report exports.
 *
 * The behaviour worth pinning is what happens when things go wrong: a row that says
 * "queued" for ever because Redis was down, or one stuck on "running" because the report
 * threw, are both worse than an error message.
 */

interface FakeJob {
  id: string;
  queue: string;
  name: string;
  status: string;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  createdAt: Date;
}

function makeHarness(options: { enqueue?: boolean; report?: unknown; reportError?: Error } = {}) {
  const jobs = new Map<string, FakeJob>();
  let sequence = 0;

  const prisma = {
    job: {
      create: vi.fn(async ({ data }: { data: Partial<FakeJob> }) => {
        const job: FakeJob = {
          id: `job-${++sequence}`,
          queue: String(data.queue),
          name: String(data.name),
          status: String(data.status ?? 'pending'),
          payload: data.payload ?? {},
          result: null,
          error: null,
          attempts: 0,
          createdAt: new Date('2026-09-11T05:00:00Z'),
        };
        jobs.set(job.id, job);
        return job;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const job = jobs.get(where.id);
        if (!job) throw new Error('no such job');
        for (const [key, value] of Object.entries(data)) {
          if (key === 'attempts' && value && typeof value === 'object') {
            job.attempts += (value as { increment: number }).increment;
          } else {
            (job as unknown as Record<string, unknown>)[key] = value;
          }
        }
        return job;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null),
      findMany: vi.fn(async () => [...jobs.values()].reverse()),
    },
  };

  const queue = {
    enqueue: vi.fn(async () => (options.enqueue === false ? null : 'bull-1')),
  };

  const storage = {
    put: vi.fn(async (_key: string, _body: Buffer): Promise<void> => undefined),
    publicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
  };

  const reports = {
    run: vi.fn(async (_key: string, _query: { limit: number }) => {
      if (options.reportError) throw options.reportError;
      return (
        options.report ?? {
          key: 'sales.by_product',
          title: 'Ventes par produit',
          from: '2026-01-01',
          to: '2026-12-31',
          columns: [
            { key: 'name', label: 'Produit', type: 'text' },
            { key: 'revenue', label: 'CA', type: 'money' },
          ],
          rows: [{ name: 'Casquette Héritage', revenue: 12_000 }],
        }
      );
    }),
  };

  const exporter = {
    toBuffer: vi.fn(async () => Buffer.from('name,revenue\nCasquette,12000\n', 'utf8')),
  };

  const service = new ReportExportsService(
    prisma as never,
    queue as never,
    storage as never,
    reports as never,
    exporter as never,
  );

  return { service, prisma, queue, storage, reports, exporter, jobs };
}

const PERIOD = {
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-12-31T00:00:00Z'),
  format: 'xlsx' as const,
};

describe('ReportExportsService — queueing', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('returns a queued row straight away, before the worker has seen it', async () => {
    const row = await harness.service.queueExport('sales.by_product', PERIOD, 'user-1');

    expect(row.status).toBe('queued');
    expect(row.key).toBe('sales.by_product');
    expect(row.from).toBe('2026-01-01');
    expect(row.downloadUrl).toBeNull();
  });

  it('puts the job on the reports queue with only the row id', async () => {
    await harness.service.queueExport('sales.by_product', PERIOD, 'user-1');

    // The payload is in the database; passing it through Redis as well would give two
    // copies that can disagree.
    expect(harness.queue.enqueue).toHaveBeenCalledWith('reports', 'report.export', {
      jobId: 'job-1',
    });
  });

  it('records who asked, because an export is a copy of the shop leaving it', async () => {
    await harness.service.queueExport('customers.cohorts', PERIOD, 'user-7');

    const created = harness.prisma.job.create.mock.calls[0]?.[0] as { data: { payload: { requestedBy: string } } };
    expect(created.data.payload.requestedBy).toBe('user-7');
  });

  it('marks the row failed when the queue is unreachable', async () => {
    const offline = makeHarness({ enqueue: false });

    const row = await offline.service.queueExport('sales.by_product', PERIOD, null);

    // The alternative is a row that says "queued" until somebody gives up on it.
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/injoignable/i);
  });
});

describe('ReportExportsService — running', () => {
  it('runs the report, uploads the file and records the row count', async () => {
    const harness = makeHarness();
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, 'user-1');

    const result = await harness.service.run(queued.id);

    expect(result.rows).toBe(1);
    expect(harness.storage.put).toHaveBeenCalledOnce();

    const [key, body] = harness.storage.put.mock.calls[0]!;
    expect(key).toMatch(/^exports\/sales-by-product-/);
    expect(key).toMatch(/\.xlsx$/);
    expect(body.length).toBeGreaterThan(0);
  });

  it('asks the report for far more rows than a screen would', async () => {
    const harness = makeHarness();
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);

    await harness.service.run(queued.id);

    const [, query] = harness.reports.run.mock.calls[0]!;
    expect(query.limit).toBeGreaterThan(500);
  });

  it('hands back a download link once the file is there', async () => {
    const harness = makeHarness();
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);
    await harness.service.run(queued.id);

    const row = await harness.service.get(queued.id);

    expect(row.status).toBe('ready');
    expect(row.rows).toBe(1);
    expect(row.downloadUrl).toMatch(/^https:\/\/cdn\.test\/exports\//);
    expect(row.title).toBe('Ventes par produit');
  });

  it('names two exports of the same report differently', async () => {
    const harness = makeHarness();
    const first = await harness.service.queueExport('sales.by_product', PERIOD, null);
    const second = await harness.service.queueExport('sales.by_product', PERIOD, null);

    await harness.service.run(first.id);
    await harness.service.run(second.id);

    const keys = harness.storage.put.mock.calls.map(([key]) => key);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('marks the row failed with the reason when the report throws', async () => {
    const harness = makeHarness({ reportError: new Error('division by zero in the margin') });
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);

    await expect(harness.service.run(queued.id)).rejects.toThrow(/division by zero/);

    const row = await harness.service.get(queued.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/division by zero/);
    // Not left on "running", which is what an operator would otherwise stare at.
    expect(row.downloadUrl).toBeNull();
  });

  it('does not upload a file when the report failed', async () => {
    const harness = makeHarness({ reportError: new Error('boom') });
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);

    await expect(harness.service.run(queued.id)).rejects.toThrow();

    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('refuses an unknown report key rather than writing an empty file', async () => {
    const harness = makeHarness();
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);
    // A payload edited in the database, or a report removed between queue and run.
    harness.jobs.get(queued.id)!.payload = { key: 'sales.by_unicorn', format: 'csv' };

    await expect(harness.service.run(queued.id)).rejects.toThrow(/inconnu/i);
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('counts the attempt, so a job retried three times says so', async () => {
    const harness = makeHarness({ reportError: new Error('flaky') });
    const queued = await harness.service.queueExport('sales.by_product', PERIOD, null);

    await expect(harness.service.run(queued.id)).rejects.toThrow();
    await expect(harness.service.run(queued.id)).rejects.toThrow();

    expect(harness.jobs.get(queued.id)?.attempts).toBe(2);
  });

  it('refuses a job id that is not an export', async () => {
    const harness = makeHarness();
    await harness.prisma.job.create({ data: { queue: 'maintenance', name: 'backup', status: 'queued' } });

    await expect(harness.service.run('job-1')).rejects.toThrow(/introuvable/i);
  });

  it('refuses a job id that does not exist at all', async () => {
    const harness = makeHarness();

    await expect(harness.service.run('nope')).rejects.toThrow(/introuvable/i);
    await expect(harness.service.get('nope')).rejects.toThrow(/introuvable/i);
  });
});
