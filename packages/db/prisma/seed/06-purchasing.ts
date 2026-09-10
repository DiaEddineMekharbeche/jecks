import type { PrismaClient } from '@prisma/client';
import { daysAgo, dzd, intBetween, log, makeRng, pick, pickMany } from './util.js';

/**
 * Suppliers, purchase orders and a stock count — PRD F-AD-52, F-AD-51.
 *
 * The point of seeding these is that every purchasing screen has something in it on a
 * fresh install: a draft to edit, an order in transit, a partially received one, a
 * closed one, and an inventory session with real variances. Costs are set here too,
 * because a catalogue with a zero cost price makes the whole P&L module render zeros.
 */

const SUPPLIERS = [
  {
    name: 'Textile Import SARL',
    contactName: 'Karim Belhadj',
    phone: '0550112233',
    email: 'contact@textile-import.dz',
    address: 'Zone industrielle Rouiba, Alger',
    note: 'Délai habituel 3 semaines. Paiement à 30 jours.',
  },
  {
    name: 'Atelier Kabylie',
    contactName: 'Lynda Ait Ali',
    phone: '0661445566',
    email: 'atelier.kabylie@gmail.com',
    address: 'Rue des Frères Ouali, Tizi Ouzou',
    note: 'Petites séries, très bonne finition.',
  },
  {
    name: 'Denim Sourcing Oran',
    contactName: 'Sofiane Meziane',
    phone: '0770998877',
    email: 'sofiane@denim-sourcing.dz',
    address: 'Boulevard Millenium, Oran',
    note: 'Le meilleur prix sur le denim brut.',
  },
];

export async function seedPurchasing(prisma: PrismaClient, ownerId: string): Promise<void> {
  const rng = makeRng(0x9e3779b9);

  const locations = await prisma.location.findMany({ orderBy: { code: 'asc' } });
  const mainLocation = locations.find((location) => location.isDefault) ?? locations[0];
  if (!mainLocation) {
    log('purchasing skipped', 'no location');
    return;
  }

  // --- suppliers -------------------------------------------------------------

  const supplierIds: string[] = [];
  for (const supplier of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({
      where: { name: supplier.name },
      select: { id: true },
    });
    const row = existing
      ? await prisma.supplier.update({ where: { id: existing.id }, data: supplier })
      : await prisma.supplier.create({ data: supplier });
    supplierIds.push(row.id);
  }
  log('suppliers', supplierIds.length);

  // --- variant costs ---------------------------------------------------------
  //
  // A believable margin: cost lands between 38 % and 52 % of the retail price, which is
  // what an Algerian ready-to-wear shop actually runs at.
  const variants = await prisma.variant.findMany({
    where: { deletedAt: null },
    select: { id: true, price: true, costPrice: true, productId: true },
  });

  let priced = 0;
  for (const variant of variants) {
    if (variant.costPrice > 0n) continue;
    const ratio = 38 + Math.floor(rng() * 15);
    await prisma.variant.update({
      where: { id: variant.id },
      data: { costPrice: (variant.price * BigInt(ratio)) / 100n },
    });
    priced += 1;
  }
  if (priced > 0) log('variant costs', priced);

  // --- purchase orders -------------------------------------------------------

  const existingOrders = await prisma.purchaseOrder.count();
  if (existingOrders > 0) {
    log('purchase orders', 'already seeded');
  } else {
    const pool = await prisma.variant.findMany({
      where: { deletedAt: null },
      select: { id: true, costPrice: true },
      take: 60,
    });

    const plans: Array<{
      status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
      daysBack: number;
      lines: number;
      receivedRatio: number;
    }> = [
      { status: 'DRAFT', daysBack: 2, lines: 4, receivedRatio: 0 },
      { status: 'ORDERED', daysBack: 9, lines: 6, receivedRatio: 0 },
      { status: 'PARTIALLY_RECEIVED', daysBack: 21, lines: 5, receivedRatio: 0.5 },
      { status: 'RECEIVED', daysBack: 40, lines: 7, receivedRatio: 1 },
      { status: 'RECEIVED', daysBack: 64, lines: 5, receivedRatio: 1 },
    ];

    let sequence = 1;
    for (const plan of plans) {
      const createdAt = daysAgo(plan.daysBack);
      const chosen = pickMany(rng, pool, plan.lines);
      if (chosen.length === 0) break;

      const items = chosen.map((variant) => {
        const quantity = intBetween(rng, 6, 30);
        const unitCost = variant.costPrice > 0n ? variant.costPrice : dzd(900);
        return {
          variantId: variant.id,
          quantity,
          unitCost,
          receivedQuantity: Math.floor(quantity * plan.receivedRatio),
        };
      });

      const subtotal = items.reduce(
        (sum, item) => sum + item.unitCost * BigInt(item.quantity),
        0n,
      );
      const shippingCost = dzd(intBetween(rng, 20, 80) * 100);
      const otherCost = dzd(intBetween(rng, 0, 30) * 100);

      const order = await prisma.purchaseOrder.create({
        data: {
          number: `PO-${createdAt.getUTCFullYear()}-${String(sequence).padStart(4, '0')}`,
          supplierId: pick(rng, supplierIds),
          locationId: mainLocation.id,
          status: plan.status,
          subtotal,
          shippingCost,
          otherCost,
          total: subtotal + shippingCost + otherCost,
          expectedAt: daysAgo(plan.daysBack - 14),
          orderedAt: plan.status === 'DRAFT' ? null : createdAt,
          receivedAt: plan.status === 'RECEIVED' ? daysAgo(Math.max(plan.daysBack - 18, 1)) : null,
          createdAt,
          note: plan.status === 'DRAFT' ? 'À valider avec le gérant.' : null,
          items: { create: items },
        },
        select: { id: true, number: true },
      });
      sequence += 1;

      // Received units are also stock: without the movements the ledger would contradict
      // the levels the catalogue seed already wrote.
      for (const item of items) {
        if (item.receivedQuantity === 0) continue;

        const level = await prisma.inventoryLevel.upsert({
          where: {
            variantId_locationId: {
              variantId: item.variantId,
              locationId: mainLocation.id,
            },
          },
          create: {
            variantId: item.variantId,
            locationId: mainLocation.id,
            onHand: item.receivedQuantity,
          },
          update: { onHand: { increment: item.receivedQuantity } },
          select: { onHand: true },
        });

        await prisma.stockMovement.create({
          data: {
            variantId: item.variantId,
            locationId: mainLocation.id,
            quantity: item.receivedQuantity,
            reason: 'PURCHASE',
            referenceType: 'purchase_order',
            referenceId: order.id,
            note: `Réception ${order.number}`,
            actorId: ownerId,
            balanceAfter: level.onHand,
            createdAt: daysAgo(Math.max(plan.daysBack - 18, 1)),
          },
        });
      }

      if (plan.status !== 'DRAFT' && plan.receivedRatio < 1) {
        for (const item of items) {
          const outstanding = item.quantity - item.receivedQuantity;
          if (outstanding <= 0) continue;
          await prisma.inventoryLevel.upsert({
            where: {
              variantId_locationId: {
                variantId: item.variantId,
                locationId: mainLocation.id,
              },
            },
            create: {
              variantId: item.variantId,
              locationId: mainLocation.id,
              incoming: outstanding,
            },
            update: { incoming: { increment: outstanding } },
          });
        }
      }
    }
    log('purchase orders', plans.length);
  }

  // --- a closed stock count with real variances ------------------------------

  const existingCounts = await prisma.stockCount.count();
  if (existingCounts > 0) {
    log('stock counts', 'already seeded');
  } else {
    const levels = await prisma.inventoryLevel.findMany({
      where: { locationId: mainLocation.id },
      select: { variantId: true, onHand: true },
      take: 25,
    });

    if (levels.length > 0) {
      await prisma.stockCount.create({
        data: {
          locationId: mainLocation.id,
          name: 'Inventaire trimestriel',
          status: 'OPEN',
          startedAt: daysAgo(1),
          note: 'Comptage rayon par rayon, à finir demain matin.',
          items: {
            create: levels.map((level, index) => {
              // Two rows in three are counted, and one in five is off by a unit or two:
              // enough variance for the report to be worth reading.
              const counted =
                index % 3 === 2
                  ? null
                  : index % 5 === 0
                    ? Math.max(level.onHand + (index % 2 === 0 ? -2 : 1), 0)
                    : level.onHand;
              return {
                variantId: level.variantId,
                expectedQuantity: level.onHand,
                countedQuantity: counted,
                variance: counted === null ? null : counted - level.onHand,
              };
            }),
          },
        },
      });
      log('stock counts', 1);
    }
  }

  // --- refresh the denormalized product stock --------------------------------

  const products = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true } });
  for (const product of products) {
    const totals = await prisma.inventoryLevel.aggregate({
      where: { variant: { productId: product.id, active: true, deletedAt: null } },
      _sum: { onHand: true, reserved: true },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { totalStock: Math.max((totals._sum.onHand ?? 0) - (totals._sum.reserved ?? 0), 0) },
    });
  }
}
