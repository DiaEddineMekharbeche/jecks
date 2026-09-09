import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { Prisma, PrismaClient };

/**
 * One client per process. Next.js and tsx reload modules on every change, so without
 * the global cache dev servers open a new pool on each edit until Postgres refuses.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(options?: Prisma.PrismaClientOptions): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
    ...options,
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** JSON-safe view of a row: BigInt money becomes a decimal string, never a float. */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)),
  ) as T;
}

/** Postgres unique-violation code, the one conflict worth handling by hand. */
export const UNIQUE_VIOLATION = 'P2002';
export const FOREIGN_KEY_VIOLATION = 'P2003';
export const RECORD_NOT_FOUND = 'P2025';

export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
