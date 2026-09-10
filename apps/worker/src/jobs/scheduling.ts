import type { PrismaClient } from '@jecks/db';

/**
 * Time-driven catalog and marketing jobs. Everything here is idempotent: the scheduler
 * may fire twice, and a redelivered job must not double-apply a price or double-send a
 * recovery message.
 */

/** Applies and reverts scheduled price changes — PRD F-AD-10 (scheduled price changes). */
export async function applyPriceSchedules(prisma: PrismaClient): Promise<{
  applied: number;
  reverted: number;
}> {
  const now = new Date();

  const due = await prisma.priceSchedule.findMany({
    where: { startsAt: { lte: now }, appliedAt: null },
    include: { variant: { select: { id: true, price: true, compareAtPrice: true } } },
  });

  for (const schedule of due) {
    await prisma.$transaction([
      prisma.variant.update({
        where: { id: schedule.variantId },
        data: { price: schedule.price, compareAtPrice: schedule.compareAtPrice },
      }),
      prisma.priceSchedule.update({
        where: { id: schedule.id },
        data: { appliedAt: now },
      }),
    ]);
    await refreshProductPriceRange(prisma, schedule.variantId);
  }

  // A window that has closed goes back to whatever the variant's neighbours say; with
  // no prior schedule to restore, the price simply stops being overridden.
  const expired = await prisma.priceSchedule.findMany({
    where: { endsAt: { lte: now }, appliedAt: { not: null }, revertedAt: null },
  });

  for (const schedule of expired) {
    await prisma.priceSchedule.update({
      where: { id: schedule.id },
      data: { revertedAt: now },
    });
    await refreshProductPriceRange(prisma, schedule.variantId);
  }

  return { applied: due.length, reverted: expired.length };
}

/**
 * A cart with a phone number, untouched for 45 minutes and never converted, becomes an
 * abandoned cart the owner can chase — PRD F-ST-46 / F-AD-25.
 */
export async function detectAbandonedCarts(prisma: PrismaClient): Promise<{ created: number }> {
  const cutoff = new Date(Date.now() - 45 * 60_000);
  const floor = new Date(Date.now() - 14 * 86_400_000);

  const candidates = await prisma.cart.findMany({
    where: {
      updatedAt: { lt: cutoff, gt: floor },
      convertedOrderId: null,
      abandoned: null,
      customerId: { not: null },
      items: { some: {} },
    },
    include: {
      customer: { select: { id: true, phone: true, fullName: true } },
      items: { select: { quantity: true, unitPrice: true } },
    },
    take: 200,
  });

  let created = 0;
  for (const cart of candidates) {
    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.unitPrice * BigInt(item.quantity),
      0n,
    );
    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    await prisma.abandonedCart.create({
      data: {
        cartId: cart.id,
        customerId: cart.customerId,
        phone: cart.customer?.phone,
        fullName: cart.customer?.fullName,
        wilayaCode: cart.wilayaCode,
        itemCount,
        subtotal,
      },
    });
    created += 1;
  }

  return { created };
}

/** Low-stock alerts — PRD F-AD-52. Returns what the notifier should send. */
export async function collectLowStockAlerts(prisma: PrismaClient): Promise<
  Array<{ variantId: string; sku: string; productName: string; available: number; threshold: number }>
> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', deletedAt: null, trackInventory: true },
    select: {
      name: true,
      lowStockThreshold: true,
      variants: {
        where: { active: true, deletedAt: null },
        select: {
          id: true,
          sku: true,
          inventoryLevels: { select: { onHand: true, reserved: true } },
        },
      },
    },
  });

  const alerts: Array<{ variantId: string; sku: string; productName: string; available: number; threshold: number }> = [];

  for (const product of products) {
    const name = (product.name as Record<string, string> | null)?.fr ?? '';
    for (const variant of product.variants) {
      const available = variant.inventoryLevels.reduce(
        (sum, level) => sum + Math.max(level.onHand - level.reserved, 0),
        0,
      );
      if (available <= product.lowStockThreshold) {
        alerts.push({
          variantId: variant.id,
          sku: variant.sku,
          productName: name,
          available,
          threshold: product.lowStockThreshold,
        });
      }
    }
  }

  return alerts;
}

/** Keeps `products.minPrice` / `maxPrice` in step with its variants. */
async function refreshProductPriceRange(prisma: PrismaClient, variantId: string): Promise<void> {
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!variant) return;

  const range = await prisma.variant.aggregate({
    where: { productId: variant.productId, active: true, deletedAt: null },
    _min: { price: true },
    _max: { price: true, compareAtPrice: true },
  });

  await prisma.product.update({
    where: { id: variant.productId },
    data: {
      minPrice: range._min.price ?? 0n,
      maxPrice: range._max.price ?? 0n,
      maxCompareAt: range._max.compareAtPrice,
    },
  });
}
