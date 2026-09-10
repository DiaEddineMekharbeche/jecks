import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedSystem } from './01-system.js';
import { seedGeo } from './02-geo.js';
import { seedCatalog } from './03-catalog.js';
import { seedContent } from './04-content.js';
import { seedDemo } from './05-demo.js';
import { seedPurchasing } from './06-purchasing.js';
import { placeholderStorageRoot } from './placeholder-media.js';

/**
 * Seed entry point — PRD Section 8: enough data that every dashboard chart renders.
 *
 *   pnpm db:seed                  full seed, including demo orders
 *   SEED_DEMO_DATA=false pnpm db:seed    structure only, for a real launch
 *
 * Every step is idempotent: running it twice does not duplicate rows.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const started = Date.now();
  const withDemo = (process.env.SEED_DEMO_DATA ?? 'true') !== 'false';

  process.stdout.write("\nSeeding Jeck's\n\n");

  process.stdout.write('System\n');
  const { ownerId } = await seedSystem(prisma);

  process.stdout.write('\nGeography, shipping and fleet\n');
  await seedGeo(prisma);

  process.stdout.write('\nCatalog\n');
  await seedCatalog(prisma);

  process.stdout.write('\nContent\n');
  await seedContent(prisma);

  process.stdout.write('\nSuppliers and purchasing\n');
  await seedPurchasing(prisma, ownerId);

  if (withDemo) {
    process.stdout.write('\nDemo trading data\n');
    await seedDemo(prisma, ownerId);
  } else {
    process.stdout.write('\nDemo data skipped (SEED_DEMO_DATA=false)\n');
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`\nDone in ${seconds}s\n`);
  process.stdout.write(`Placeholder media written to ${placeholderStorageRoot()}\n`);
  process.stdout.write(
    `Sign in at the admin with ${process.env.SEED_OWNER_EMAIL ?? 'owner@jecks.dz'} / ${
      process.env.SEED_OWNER_PASSWORD ?? 'Jecks2026!'
    }\n\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.exitCode = 1;
    console.error('\nSeed failed:', error);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
