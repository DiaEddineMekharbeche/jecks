import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The whole application, against real databases — PRD Section 2.3.
 *
 * Deliberately the same wiring as `main.ts`: the global prefix, the cookie parser and
 * `rawBody`. A harness that skips them tests a different application from the one that
 * ships, and the difference is always the interesting part — a webhook signature read
 * from a re-serialised body, or a route that only 404s because the prefix was missing.
 *
 * What is left out is what the network provides and the tests do not touch: helmet,
 * compression, CORS and Swagger.
 */

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  /** supertest agent, already pointed at the app's server. */
  http: TestAgent;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    http: request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Reference data every test needs and no test should have to recreate.
 *
 * The wilayas and communes come from the seed, the roles and permissions from the
 * catalogue, and the staff accounts are created once in `beforeAll` — truncating those
 * between tests would invalidate the tokens the suite is holding.
 */
const KEEP = new Set([
  '_prisma_migrations',
  'wilayas',
  'communes',
  'shipping_zones',
  'shipping_rates',
  'pickup_points',
  'locations',
  'couriers',
  'settings',
  'notification_templates',
  'permissions',
  'roles',
  'role_permissions',
  'users',
  'user_roles',
  'sessions',
]);

/**
 * Empties everything a test might have written.
 *
 * The table list is read from the database rather than written down here, because a
 * hardcoded list silently stops covering the table somebody adds next — and a leftover
 * row from the previous test is the kind of failure that gets blamed on the test that
 * found it.
 *
 * `TRUNCATE ... CASCADE` ignores foreign-key order, which is why it is used, but it also
 * empties anything referencing what it truncates — and that reaches backwards into the
 * keep list. `users` has an avatar pointing at `media`, so truncating media silently
 * deleted the staff accounts the suite had signed in as, and the next write failed on a
 * foreign key that looked like an application bug. So the keep list is closed over its
 * own references before anything is truncated.
 */
export async function resetData(prisma: PrismaService): Promise<void> {
  const [tables, edges] = await Promise.all([
    prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `,
    prisma.$queryRaw<Array<{ child: string; parent: string }>>`
      SELECT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `,
  ]);

  const keep = new Set(KEEP);
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      if (keep.has(edge.child) && !keep.has(edge.parent)) {
        keep.add(edge.parent);
        changed = true;
      }
    }
  }

  const targets = tables.map((row) => row.table_name).filter((name) => !keep.has(name));
  if (targets.length === 0) return;

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
