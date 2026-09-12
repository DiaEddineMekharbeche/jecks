import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Fixtures for the integration suite — PRD Section 2.3.
 *
 * Each one writes the minimum a test needs and returns the row. They take overrides
 * rather than accepting a full payload, so a test reads as the one thing it is about:
 * `await sellableProduct(prisma, { price: 0n })` says what is being tested, and forty
 * lines of Prisma `create` in the test body would not.
 *
 * Everything is unique per call. Tests share a database and a suite that only passes
 * in file order is worse than no suite.
 */

export interface SellableProduct {
  productId: string;
  variantId: string;
  sku: string;
  slug: string;
  price: bigint;
}

/** A published product with one variant and stock on the shelf. */
export async function sellableProduct(
  prisma: PrismaService,
  overrides: { price?: bigint; onHand?: number; trackInventory?: boolean } = {},
): Promise<SellableProduct> {
  const suffix = randomUUID().slice(0, 8);
  const price = overrides.price ?? 350_000n;

  const product = await prisma.product.create({
    data: {
      name: { fr: `Casquette ${suffix}`, en: `Cap ${suffix}`, ar: `قبعة ${suffix}` },
      slug: `cap-${suffix}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      trackInventory: overrides.trackInventory ?? true,
      minPrice: price,
      maxPrice: price,
    },
  });

  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      sku: `SKU-${suffix}`.toUpperCase(),
      name: 'Noir / M',
      price,
      costPrice: price / 2n,
      weightGrams: 200,
    },
  });

  const location = await defaultLocation(prisma);

  await prisma.inventoryLevel.create({
    data: {
      variantId: variant.id,
      locationId: location.id,
      onHand: overrides.onHand ?? 25,
      reserved: 0,
    },
  });

  return {
    productId: product.id,
    variantId: variant.id,
    sku: variant.sku,
    slug: product.slug,
    price,
  };
}

/** The warehouse. Created once and reused, because inventory is per location. */
export async function defaultLocation(prisma: PrismaService): Promise<{ id: string }> {
  const existing = await prisma.location.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;

  return prisma.location.create({
    data: { code: 'TEST', name: 'Entrepôt de test', wilayaCode: 16, isDefault: true },
  });
}

export async function customer(
  prisma: PrismaService,
  overrides: { phone?: string; blacklisted?: boolean } = {},
): Promise<{ id: string; phone: string }> {
  const phone = overrides.phone ?? `+2136${String(Date.now()).slice(-8)}`;

  const row = await prisma.customer.create({
    data: {
      phone,
      fullName: 'Client de test',
      blacklisted: overrides.blacklisted ?? false,
    },
  });

  return { id: row.id, phone: row.phone };
}

/**
 * A cart with one line, as the storefront would have left it.
 *
 * Returns the token rather than the id: that is what checkout takes, and a test that
 * has to look the token up is a test that knows too much about the schema.
 */
export async function cartWithItem(
  prisma: PrismaService,
  product: SellableProduct,
  quantity = 1,
): Promise<{ token: string; id: string }> {
  const cart = await prisma.cart.create({
    data: {
      token: randomUUID().replace(/-/g, ''),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      items: {
        create: [{ variantId: product.variantId, quantity, unitPrice: product.price }],
      },
    },
  });

  return { token: cart.token, id: cart.id };
}

/** The first commune of a wilaya, which checkout needs and the migrations seeded. */
export async function someCommune(
  prisma: PrismaService,
  wilayaCode = 16,
): Promise<{ id: string; wilayaCode: number }> {
  const commune = await prisma.commune.findFirst({ where: { wilayaCode } });
  if (commune) return { id: commune.id, wilayaCode };

  // The reference data is loaded by the seed, not the migrations, so a bare database
  // gets one made here rather than failing with something unhelpful.
  const created = await prisma.commune.create({
    data: {
      wilayaCode,
      name: { fr: 'Commune de test', en: 'Test commune', ar: 'بلدية' },
      nameAscii: `Commune de test ${wilayaCode}`,
    },
  });

  return { id: created.id, wilayaCode };
}
