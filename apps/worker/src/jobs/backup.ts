import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@jecks/db';
import type { StorageProvider } from '@jecks/storage';

/**
 * Nightly and on-demand database backup — PRD Section 10.10.
 *
 * `pg_dump` in custom format (`-Fc`), which is compressed and restorable selectively
 * with `pg_restore`. A plain SQL dump of a catalogue with media metadata is several
 * times larger for no benefit anyone has ever used at three in the morning.
 *
 * The dump is written to a temporary file rather than streamed straight to storage,
 * because a truncated upload that still gets stored is worse than a failed backup: it
 * looks fine in the list until the day someone needs it.
 */

export interface BackupResult {
  key: string;
  sizeBytes: number;
  durationMs: number;
  pruned: number;
}

export interface BackupOptions {
  /** The `Job` row to report progress on; created by the API before enqueueing. */
  jobId?: string;
  databaseUrl?: string;
  /** Copies older than this are deleted after a successful dump. */
  retentionDays?: number;
  /** Injected in tests so the suite never shells out. */
  runDump?: (databaseUrl: string, target: string) => Promise<void>;
  now?: Date;
}

const DEFAULT_RETENTION_DAYS = 14;

export async function runBackup(
  prisma: PrismaClient,
  storage: StorageProvider,
  options: BackupOptions = {},
): Promise<BackupResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL is not set; cannot take a backup');

  if (options.jobId) {
    await prisma.job.update({
      where: { id: options.jobId },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  const directory = await mkdtemp(join(tmpdir(), 'jecks-backup-'));
  const filename = `jecks-${stamp(now)}.dump`;
  const target = join(directory, filename);
  const key = `backups/${filename}`;

  try {
    await (options.runDump ?? pgDump)(databaseUrl, target);

    const info = await stat(target);
    if (info.size === 0) throw new Error('pg_dump produced an empty file');

    await storage.put(key, await readFile(target), 'application/octet-stream');

    const pruned = await prune(storage, options.retentionDays ?? DEFAULT_RETENTION_DAYS, now);
    const result: BackupResult = {
      key,
      sizeBytes: info.size,
      durationMs: Date.now() - started,
      pruned,
    };

    if (options.jobId) {
      await prisma.job.update({
        where: { id: options.jobId },
        data: { status: 'completed', finishedAt: new Date(), result: result as never },
      });
    }
    return result;
  } catch (error) {
    if (options.jobId) {
      await prisma.job.update({
        where: { id: options.jobId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Deletes backups older than the retention window. Never touches anything else. */
async function prune(
  storage: StorageProvider,
  retentionDays: number,
  now: Date,
): Promise<number> {
  if (retentionDays <= 0) return 0;

  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const keys = await storage.list('backups/');
  let pruned = 0;

  for (const key of keys) {
    const when = dateFromKey(key);
    if (!when || when >= cutoff) continue;
    await storage.remove(key);
    pruned += 1;
  }
  return pruned;
}

/** `jecks-2026-09-10T02-00-00.dump` → the date it was taken. */
export function dateFromKey(key: string): Date | null {
  const match = /jecks-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.dump$/.exec(key);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match as unknown as string[];
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

/**
 * Splits a connection URL into the `PG*` variables `pg_dump` reads.
 *
 * Passing the URL on the command line would put the database password in the process
 * list, where any other user on the box can read it.
 */
export function pgEnvFrom(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
  };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

  // Prisma carries the schema as a query parameter; pg_dump wants it as a search path.
  const schema = url.searchParams.get('schema');
  if (schema) env.PGOPTIONS = `--search_path=${schema}`;

  return env;
}

function pgDump(databaseUrl: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', target], {
      env: { ...process.env, ...pgEnvFrom(databaseUrl) },
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(
        new Error(
          `pg_dump could not be started (${error.message}). Is the PostgreSQL client installed on this host?`,
        ),
      );
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with ${code}: ${stderr.trim().slice(0, 500)}`));
    });

    child.stdin.end();
  });
}
