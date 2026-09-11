import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedSystem } from './01-system.js';
import { seedGeo } from './02-geo.js';
import { seedCatalog } from './03-catalog.js';
import { seedContent } from './04-content.js';
import { seedDemo } from './05-demo.js';
import { seedPurchasing } from './06-purchasing.js';
import { seedEngagement } from './07-engagement.js';
import { placeholderStorageRoot } from './placeholder-media.js';
import { seedScope } from './util.js';

/**
 * Seed entry point — PRD Section 8: enough data that every dashboard chart renders.
 *
 *   pnpm db:seed                          everything, including demo orders
 *   SEED_SCOPE=structure pnpm db:seed     catalogue and content, no trading history
 *   SEED_SCOPE=minimal   pnpm db:seed     a real shop's first day: the owner, the
 *                                         wilayas, the rates, the settings, nothing else
 *
 * Every step is idempotent: running it twice does not duplicate rows.
 *
 * Note for a reset: `prisma migrate reset` runs this seed in a child process that does
 * not carry an inline SEED_SCOPE through, so it always seeds `full`. To reset to a
 * narrower scope, skip the seed and run it yourself:
 *
 *   prisma migrate reset --force --skip-seed
 *   SEED_SCOPE=minimal pnpm db:seed
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const started = Date.now();
  const scope = seedScope();

  process.stdout.write(`\nSeeding Jeck's (${scope})\n\n`);

  process.stdout.write('System\n');
  const { ownerId } = await seedSystem(prisma, scope);

  process.stdout.write('\nGeography, shipping and fleet\n');
  await seedGeo(prisma, scope);

  if (scope === 'minimal') {
    process.stdout.write('\nCatalogue, content and demo data skipped (SEED_SCOPE=minimal)\n');
  } else {
    process.stdout.write('\nCatalog\n');
    await seedCatalog(prisma);

    process.stdout.write('\nContent\n');
    await seedContent(prisma);

    process.stdout.write('\nSuppliers and purchasing\n');
    await seedPurchasing(prisma, ownerId);
  }

  if (scope === 'full') {
    process.stdout.write('\nDemo trading data\n');
    await seedDemo(prisma, ownerId);

    process.stdout.write('\nShopper engagement\n');
    await seedEngagement(prisma);
  } else if (scope === 'structure') {
    process.stdout.write(`\nDemo trading data skipped (SEED_SCOPE=${scope})\n`);
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
