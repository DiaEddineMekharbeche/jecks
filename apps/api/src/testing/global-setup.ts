import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * A real Postgres and a real Redis for the integration suite — PRD Section 2.3.
 *
 * Unit tests stub Prisma, which proves the arithmetic and proves nothing about the
 * queries. These start the actual databases once for the whole run, apply the real
 * migrations, and let the controllers talk to them through the real guards and
 * interceptors. What they catch is everything a stub agrees to: a column that does not
 * exist, a compound unique that rejects a null, a permission that was never wired.
 *
 * Containers rather than a shared database, because a suite that only passes when
 * somebody remembered to reset their local Postgres is not a suite. Point
 * `INTEGRATION_DATABASE_URL` at your own instance to skip the wait while iterating.
 */

// Vitest runs with the package as its working directory.
const dbPackage = resolve(process.cwd(), '../../packages/db');
const tsxCli = require.resolve('tsx/cli');

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const databaseUrl = process.env.INTEGRATION_DATABASE_URL ?? (await startPostgres());
  const redisUrl = process.env.INTEGRATION_REDIS_URL ?? (await startRedis());

  // The real migrations, not `db push`: a migration that only applies to a database
  // which already has data is exactly the bug worth catching here.
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  // Reference data, not demo data: the 58 wilayas and their communes, the roles and
  // permissions the guard reads, the settings and the couriers. Fixtures build products
  // and orders per test, but nothing should have to invent a wilaya.
  execFileSync(process.execPath, [tsxCli, 'prisma/seed/index.ts'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: databaseUrl, SEED_SCOPE: 'minimal' },
    stdio: 'inherit',
  });

  provide('databaseUrl', databaseUrl);
  provide('redisUrl', redisUrl);

  return async () => {
    await redis?.stop().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  };
}

async function startPostgres(): Promise<string> {
  postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('jecks_test')
    .withUsername('jecks')
    .withPassword('jecks')
    // Durability buys nothing for a database that is deleted at the end of the run, and
    // costs a fsync on every write.
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  return `${postgres.getConnectionUri()}?schema=public`;
}

async function startRedis(): Promise<string> {
  redis = await new RedisContainer('redis:7-alpine').start();
  return redis.getConnectionUrl();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
