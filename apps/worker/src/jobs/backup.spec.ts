import { writeFile } from 'node:fs/promises';
import type { StorageProvider } from '@jecks/storage';
import { describe, expect, it } from 'vitest';
import { dateFromKey, pgEnvFrom, runBackup, stamp } from './backup.js';

/**
 * The dump itself is injected, so the suite exercises the parts that can be wrong —
 * naming, retention, the failure path and the job row — without needing PostgreSQL or
 * a `pg_dump` binary on the machine running the tests.
 */

function fakeStorage(existing: string[] = []) {
  const objects = new Map<string, Buffer>(existing.map((key) => [key, Buffer.from('x')]));
  const storage = {
    driver: 'local' as const,
    get: async (key: string) => objects.get(key) ?? Buffer.alloc(0),
    put: async (key: string, body: Buffer) => {
      objects.set(key, body);
    },
    exists: async (key: string) => objects.has(key),
    remove: async (key: string) => {
      objects.delete(key);
    },
    list: async (prefix: string) => [...objects.keys()].filter((key) => key.startsWith(prefix)),
    publicUrl: (key: string | null | undefined) => (key ? `/media/${key}` : null),
  } satisfies StorageProvider;
  return { storage, objects };
}

function fakePrisma() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    prisma: {
      job: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return data;
        },
      },
    } as never,
  };
}

const NOW = new Date('2026-09-10T02:00:00.000Z');
const DUMP = async (_url: string, target: string) => {
  await writeFile(target, Buffer.alloc(4096, 1));
};

describe('runBackup', () => {
  it('writes a timestamped dump to the backups prefix', async () => {
    const { storage, objects } = fakeStorage();
    const { prisma } = fakePrisma();

    const result = await runBackup(prisma, storage, {
      databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
      now: NOW,
      runDump: DUMP,
    });

    expect(result.key).toBe('backups/jecks-2026-09-10T02-00-00.dump');
    expect(result.sizeBytes).toBe(4096);
    expect(objects.has(result.key)).toBe(true);
  });

  it('refuses to store an empty dump', async () => {
    const { storage, objects } = fakeStorage();
    const { prisma } = fakePrisma();

    await expect(
      runBackup(prisma, storage, {
        databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
        now: NOW,
        runDump: async (_url, target) => {
          await writeFile(target, Buffer.alloc(0));
        },
      }),
    ).rejects.toThrow(/empty file/);

    expect(objects.size).toBe(0);
  });

  it('deletes copies past the retention window and keeps the rest', async () => {
    const { storage, objects } = fakeStorage([
      'backups/jecks-2026-08-01T02-00-00.dump', // 40 days old
      'backups/jecks-2026-09-08T02-00-00.dump', // 2 days old
      'backups/notes.txt', // not ours
    ]);
    const { prisma } = fakePrisma();

    const result = await runBackup(prisma, storage, {
      databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
      now: NOW,
      retentionDays: 14,
      runDump: DUMP,
    });

    expect(result.pruned).toBe(1);
    expect(objects.has('backups/jecks-2026-08-01T02-00-00.dump')).toBe(false);
    expect(objects.has('backups/jecks-2026-09-08T02-00-00.dump')).toBe(true);
    // A file that does not follow the naming scheme is left alone: the prune must not
    // be a way to delete something a person put there.
    expect(objects.has('backups/notes.txt')).toBe(true);
  });

  it('keeps everything when retention is disabled', async () => {
    const { storage, objects } = fakeStorage(['backups/jecks-2020-01-01T02-00-00.dump']);
    const { prisma } = fakePrisma();

    const result = await runBackup(prisma, storage, {
      databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
      now: NOW,
      retentionDays: 0,
      runDump: DUMP,
    });

    expect(result.pruned).toBe(0);
    expect(objects.has('backups/jecks-2020-01-01T02-00-00.dump')).toBe(true);
  });

  it('marks the job row running, then completed, with the result', async () => {
    const { storage } = fakeStorage();
    const { prisma, updates } = fakePrisma();

    await runBackup(prisma, storage, {
      jobId: 'job-1',
      databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
      now: NOW,
      runDump: DUMP,
    });

    expect(updates[0]).toMatchObject({ status: 'running' });
    expect(updates[1]).toMatchObject({ status: 'completed' });
    expect((updates[1] as { result: { key: string } }).result.key).toContain('backups/');
  });

  it('marks the job failed and rethrows when the dump fails', async () => {
    const { storage } = fakeStorage();
    const { prisma, updates } = fakePrisma();

    await expect(
      runBackup(prisma, storage, {
        jobId: 'job-2',
        databaseUrl: 'postgresql://u:p@localhost:5432/jecks',
        now: NOW,
        runDump: () => Promise.reject(new Error('pg_dump exited with 1')),
      }),
    ).rejects.toThrow(/pg_dump exited/);

    expect(updates[1]).toMatchObject({ status: 'failed', error: 'pg_dump exited with 1' });
  });

  it('refuses to run without a database url', async () => {
    const { storage } = fakeStorage();
    const { prisma } = fakePrisma();
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';

    await expect(runBackup(prisma, storage, { runDump: DUMP })).rejects.toThrow(/DATABASE_URL/);

    process.env.DATABASE_URL = saved;
  });
});

describe('naming', () => {
  it('round-trips a stamp through the key parser', () => {
    const key = `backups/jecks-${stamp(NOW)}.dump`;
    expect(dateFromKey(key)?.toISOString()).toBe(NOW.toISOString());
  });

  it('ignores anything that is not one of ours', () => {
    expect(dateFromKey('backups/notes.txt')).toBeNull();
    expect(dateFromKey('backups/jecks-latest.dump')).toBeNull();
  });
});

describe('pgEnvFrom', () => {
  it('splits a connection url into PG variables', () => {
    expect(pgEnvFrom('postgresql://jecks:secret@db.internal:5434/jecks?schema=public')).toEqual({
      PGHOST: 'db.internal',
      PGPORT: '5434',
      PGDATABASE: 'jecks',
      PGUSER: 'jecks',
      PGPASSWORD: 'secret',
      PGOPTIONS: '--search_path=public',
    });
  });

  it('defaults the port and copes with no credentials', () => {
    expect(pgEnvFrom('postgresql://localhost/jecks')).toEqual({
      PGHOST: 'localhost',
      PGPORT: '5432',
      PGDATABASE: 'jecks',
    });
  });

  it('decodes a percent-encoded password rather than passing it through', () => {
    const env = pgEnvFrom('postgresql://u:p%40ss%2Fword@localhost:5432/jecks');
    expect(env.PGPASSWORD).toBe('p@ss/word');
  });
});
