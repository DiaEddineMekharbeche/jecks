import type { OrderStatus, PrismaClient } from '@prisma/client';
import { WILAYAS } from './data/wilayas.js';
import { daysAgo, dzd, intBetween, log, makeRng, orderNumber, pick, startOfDayUtc, tr } from './util.js';

const FIRST_NAMES = [
  'Yacine', 'Amine', 'Sofiane', 'Karim', 'Bilal', 'Mehdi', 'Riad', 'Anis', 'Walid', 'Nabil',
  'Lina', 'Nadia', 'Sarah', 'Meriem', 'Amina', 'Yasmine', 'Ines', 'Kahina', 'Rania', 'Imene',
];
const LAST_NAMES = [
  'Benali', 'Haddad', 'Cherif', 'Slimani', 'Boumediene', 'Zerrouki', 'Amrani', 'Belkacem',
  'Mansouri', 'Bouzid', 'Kaci', 'Taleb', 'Ouali', 'Rahmani', 'Meziane', 'Saidi',
];

/** Weighted status mix that looks like a real COD store two months in. */
const STATUS_MIX: Array<{ status: OrderStatus; weight: number }> = [
  { status: 'PENDING', weight: 8 },
  { status: 'CONFIRMED', weight: 8 },
  { status: 'PACKED', weight: 5 },
  { status: 'SHIPPED', weight: 7 },
  { status: 'OUT_FOR_DELIVERY', weight: 5 },
  { status: 'DELIVERED', weight: 45 },
  { status: 'FAILED', weight: 8 },
  { status: 'RETURNED', weight: 4 },
  { status: 'CANCELLED', weight: 8 },
  { status: 'REFUNDED', weight: 2 },
];

const SOURCES = ['WEB', 'WEB', 'WEB', 'INSTAGRAM', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'PHONE'] as const;

/** Wilayas weighted by where Algerian e-commerce volume actually lands. */
const WILAYA_WEIGHTS: Array<[number, number]> = [
  [16, 22], [31, 10], [25, 7], [19, 6], [9, 5], [35, 4], [15, 4], [6, 4], [23, 3], [5, 3],
  [42, 3], [13, 3], [34, 2], [27, 2], [21, 2], [43, 2], [18, 2], [26, 2], [7, 2], [30, 2],
  [39, 1], [47, 1], [17, 1], [28, 1], [22, 1], [24, 1], [10, 1], [44, 1], [2, 1], [29, 1],
];

function weightedStatus(rng: () => number): OrderStatus {
  const total = STATUS_MIX.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of STATUS_MIX) {
    roll -= entry.weight;
    if (roll <= 0) return entry.status;
  }
  return 'DELIVERED';
}

function weightedWilaya(rng: () => number): number {
  const total = WILAYA_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [code, weight] of WILAYA_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return code;
  }
  return 16;
}

const DELIVERED_LIKE: OrderStatus[] = ['DELIVERED', 'RETURNED', 'REFUNDED'];
const SHIPPED_LIKE: OrderStatus[] = ['SHIPPED', 'OUT_FOR_DELIVERY', ...DELIVERED_LIKE, 'FAILED'];

export async function seedDemo(prisma: PrismaClient, ownerId: string): Promise<void> {
  const rng = makeRng(770425);

  await clearDemoData(prisma);
  await seedPromotions(prisma);

  const variants = await prisma.variant.findMany({
    where: { active: true },
    select: { id: true, price: true, costPrice: true, sku: true, name: true, weightGrams: true, productId: true },
  });
  const products = new Map(
    (await prisma.product.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  const wilayaNames = new Map(WILAYAS.map((w) => [w.code, w.fr]));
  const communesByWilaya = new Map<number, Array<{ id: string; nameAscii: string }>>();
  for (const commune of await prisma.commune.findMany({ select: { id: true, wilayaCode: true, nameAscii: true } })) {
    const list = communesByWilaya.get(commune.wilayaCode) ?? [];
    list.push({ id: commune.id, nameAscii: commune.nameAscii });
    communesByWilaya.set(commune.wilayaCode, list);
  }
  const rates = await prisma.shippingRate.findMany({
    select: { wilayaCode: true, deliveryType: true, price: true, cost: true, courierId: true },
  });
  // The promotions that were just seeded. Discounts below are granted by one of these
  // and recorded as a usage, so the promotion screens read real attribution rather than
  // an unexplained number sitting in `discountTotal`.
  const livePromotions = await prisma.promotion.findMany({
    where: { active: true, deletedAt: null },
    select: { id: true, code: true, type: true, percentOff: true, tiers: true, minSubtotal: true },
  });
  const codedPromotions = livePromotions.filter(
    (promotion) => promotion.code !== null && promotion.type === 'PERCENTAGE',
  );
  const tieredPromotion = livePromotions.find((promotion) => promotion.type === 'TIERED');
  const freeShippingPromotion = livePromotions.find(
    (promotion) => promotion.type === 'FREE_SHIPPING',
  );

  const couriers = await prisma.courier.findMany({ select: { id: true, slug: true } });
  const yalidine = couriers.find((c) => c.slug === 'yalidine');
  const ownFleet = couriers.find((c) => c.slug === 'own-fleet');
  const drivers = await prisma.driver.findMany({ select: { id: true } });
  const agents = await prisma.user.findMany({
    where: { email: { in: ['agent@jecks.dz', 'manager@jecks.dz'] } },
    select: { id: true },
  });
  const mainLocation = await prisma.location.findFirst({ where: { isDefault: true } });

  if (variants.length === 0 || !mainLocation) {
    throw new Error('Seed the catalog before the demo data');
  }

  // --- customers -------------------------------------------------------------
  const customerCount = 120;
  const customerIds: string[] = [];
  for (let i = 0; i < customerCount; i += 1) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const prefix = pick(rng, ['5', '6', '7']);
    const phone = `+213${prefix}${String(50_000_000 + i * 7919).slice(0, 8)}`;
    const customer = await prisma.customer.upsert({
      where: { phone },
      create: {
        phone,
        fullName: `${first} ${last}`,
        email: rng() < 0.35 ? `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.dz` : null,
        acceptsMarketing: rng() < 0.5,
      },
      update: {},
    });
    customerIds.push(customer.id);
  }
  log('customers', customerCount);

  // Blacklist a couple so the fraud screens have data (F-AD-36).
  for (const id of customerIds.slice(0, 2)) {
    await prisma.customer.update({
      where: { id },
      data: { blacklisted: true, blacklistReason: '3 refus de colis consécutifs', segment: 'BLACKLISTED' },
    });
  }

  // --- orders ----------------------------------------------------------------
  const DAYS = 75;
  const perDayCounter = new Map<string, number>();
  let orderCount = 0;
  let shipmentCount = 0;

  for (let dayOffset = DAYS; dayOffset >= 0; dayOffset -= 1) {
    // More orders recently, and a bump on the flash-sale days.
    const trend = 1 + (DAYS - dayOffset) / DAYS;
    const spike = dayOffset === 12 || dayOffset === 13 ? 2.2 : 1;
    const ordersToday = Math.max(1, Math.round((3 + rng() * 5) * trend * spike));

    for (let n = 0; n < ordersToday; n += 1) {
      const createdAt = daysAgo(dayOffset, intBetween(rng, 8, 22));
      const dayKey = createdAt.toISOString().slice(0, 10);
      const sequence = (perDayCounter.get(dayKey) ?? 0) + 1;
      perDayCounter.set(dayKey, sequence);

      const status = dayOffset < 3 ? pick(rng, ['PENDING', 'PENDING', 'CONFIRMED', 'PACKED'] as OrderStatus[]) : weightedStatus(rng);
      const wilayaCode = weightedWilaya(rng);
      const communes = communesByWilaya.get(wilayaCode) ?? [];
      const commune = communes.length > 0 ? pick(rng, communes) : null;
      const deliveryType = rng() < 0.62 ? 'HOME' : 'STOP_DESK';
      const customerId = pick(rng, customerIds);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

      const rate =
        rates.find((r) => r.wilayaCode === wilayaCode && r.deliveryType === deliveryType) ??
        rates.find((r) => r.deliveryType === deliveryType);
      const lineCount = rng() < 0.62 ? 1 : rng() < 0.88 ? 2 : 3;
      const chosen = Array.from({ length: lineCount }, () => pick(rng, variants));

      let itemsSubtotal = 0n;
      let cogsTotal = 0n;
      let weightGrams = 0;
      let itemCount = 0;
      const lines = chosen.map((variant) => {
        const quantity = rng() < 0.85 ? 1 : 2;
        const lineTotal = variant.price * BigInt(quantity);
        itemsSubtotal += lineTotal;
        cogsTotal += variant.costPrice * BigInt(quantity);
        weightGrams += variant.weightGrams * quantity;
        itemCount += quantity;
        return { variant, quantity, lineTotal };
      });

      // 1 order in 4 carries a code; larger carts also reach the automatic tier. Each
      // grant names the promotion that made it, and becomes a usage row further down.
      const grants: Array<{ promotionId: string; amount: bigint }> = [];

      if (codedPromotions.length > 0 && rng() < 0.25) {
        const promotion = pick(rng, codedPromotions);
        const percent = Number(promotion.percentOff ?? 0);
        const amount = (itemsSubtotal * BigInt(Math.round(percent))) / 100n;
        if (amount > 0n) grants.push({ promotionId: promotion.id, amount });
      } else if (tieredPromotion) {
        const tiers = (tieredPromotion.tiers as Array<{ minSubtotal: string; percentOff: number }> | null) ?? [];
        const reached = tiers
          .filter((tier) => itemsSubtotal >= BigInt(tier.minSubtotal))
          .sort((a, b) => b.percentOff - a.percentOff)[0];
        if (reached) {
          const amount = (itemsSubtotal * BigInt(reached.percentOff)) / 100n;
          if (amount > 0n) grants.push({ promotionId: tieredPromotion.id, amount });
        }
      }

      const discountTotal = grants.reduce((sum, grant) => sum + grant.amount, 0n);
      const freeShippingThreshold = freeShippingPromotion?.minSubtotal ?? 600000n;
      const freeShipping = itemsSubtotal - discountTotal >= freeShippingThreshold;
      const shippingTotal = freeShipping ? 0n : (rate?.price ?? 50000n);
      if (freeShipping && freeShippingPromotion) {
        grants.push({ promotionId: freeShippingPromotion.id, amount: rate?.price ?? 50000n });
      }
      const shippingCost = SHIPPED_LIKE.includes(status) ? (rate?.cost ?? 35000n) : 0n;
      const total = itemsSubtotal - discountTotal + shippingTotal;

      const isPaid = status === 'DELIVERED';
      const isRefunded = status === 'REFUNDED';
      const source = pick(rng, SOURCES);

      const order = await prisma.order.create({
        data: {
          number: orderNumber(createdAt, sequence),
          customerId,
          agentId: status === 'PENDING' ? null : agents.length > 0 ? pick(rng, agents).id : ownerId,
          status,
          paymentStatus: isRefunded ? 'REFUNDED' : isPaid ? 'PAID' : 'UNPAID',
          paymentMethod: 'COD',
          source,
          customerName: customer.fullName,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          wilayaCode,
          wilayaName: wilayaNames.get(wilayaCode) ?? String(wilayaCode),
          communeId: commune?.id,
          communeName: commune?.nameAscii,
          deliveryType,
          address: deliveryType === 'HOME' ? `Cité ${intBetween(rng, 1, 400)} logements, bât ${intBetween(rng, 1, 20)}` : null,
          itemsSubtotal,
          discountTotal,
          shippingTotal,
          shippingCost,
          total,
          cogsTotal,
          paidTotal: isPaid ? total : 0n,
          refundedTotal: isRefunded ? total : 0n,
          weightGrams,
          itemCount,
          riskScore: customer.blacklisted ? 90 : intBetween(rng, 0, 35),
          utmSource: source === 'INSTAGRAM' ? 'instagram' : source === 'TIKTOK' ? 'tiktok' : source === 'FACEBOOK' ? 'facebook' : 'direct',
          utmMedium: source === 'WEB' ? 'organic' : 'paid_social',
          utmCampaign: rng() < 0.5 ? 'rentree-2026' : 'always-on',
          createdAt,
          updatedAt: createdAt,
          confirmedAt: status === 'PENDING' ? null : new Date(createdAt.getTime() + 3600_000),
          packedAt: ['PACKED', ...SHIPPED_LIKE].includes(status) ? new Date(createdAt.getTime() + 7200_000) : null,
          shippedAt: SHIPPED_LIKE.includes(status) ? new Date(createdAt.getTime() + 86_400_000) : null,
          deliveredAt: DELIVERED_LIKE.includes(status) ? new Date(createdAt.getTime() + 2 * 86_400_000) : null,
          cancelledAt: status === 'CANCELLED' ? new Date(createdAt.getTime() + 5400_000) : null,
          returnedAt: ['RETURNED', 'REFUNDED'].includes(status) ? new Date(createdAt.getTime() + 5 * 86_400_000) : null,
          items: {
            create: lines.map(({ variant, quantity, lineTotal }) => ({
              variantId: variant.id,
              productName: products.get(variant.productId) ?? tr('Casquette'),
              variantName: variant.name,
              sku: variant.sku,
              quantity,
              unitPrice: variant.price,
              unitCost: variant.costPrice,
              lineTotal,
            })),
          },
          events: {
            create: [
              { kind: 'status', toStatus: 'PENDING', reason: 'Commande passée', createdAt },
              ...(status === 'PENDING'
                ? []
                : [{ kind: 'status', fromStatus: 'PENDING' as OrderStatus, toStatus: status, reason: 'Confirmée par téléphone', createdAt: new Date(createdAt.getTime() + 3600_000) }]),
            ],
          },
        },
      });
      orderCount += 1;

      for (const grant of grants) {
        await prisma.promoUsage.create({
          data: {
            promotionId: grant.promotionId,
            orderId: order.id,
            customerId,
            amount: grant.amount,
            createdAt,
          },
        });
        await prisma.promotion.update({
          where: { id: grant.promotionId },
          data: { usageCount: { increment: 1 } },
        });
      }

      // Call log for anything that got past PENDING (F-AD-31).
      if (status !== 'PENDING') {
        await prisma.callLog.create({
          data: {
            orderId: order.id,
            agentId: agents.length > 0 ? pick(rng, agents).id : ownerId,
            outcome: status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
            note: status === 'CANCELLED' ? 'Client a changé d’avis' : 'Adresse et taille confirmées',
            createdAt: new Date(createdAt.getTime() + 2400_000),
          },
        });
      }

      // Shipment for anything that left the warehouse.
      if (SHIPPED_LIKE.includes(status)) {
        const useOwnFleet = wilayaCode === 16 && rng() < 0.45 && ownFleet;
        const courierId = useOwnFleet ? ownFleet?.id : yalidine?.id;
        const shipmentStatus =
          status === 'DELIVERED' ? 'DELIVERED' : status === 'FAILED' ? 'FAILED' : status === 'RETURNED' || status === 'REFUNDED' ? 'RETURNED' : status === 'OUT_FOR_DELIVERY' ? 'OUT_FOR_DELIVERY' : 'IN_TRANSIT';
        await prisma.shipment.create({
          data: {
            orderId: order.id,
            courierId,
            driverId: useOwnFleet && drivers.length > 0 ? pick(rng, drivers).id : null,
            status: shipmentStatus,
            trackingNumber: `YAL${String(100000 + orderCount)}`,
            trackingUrl: `https://tracking.example.dz/YAL${String(100000 + orderCount)}`,
            attempts: status === 'FAILED' ? 2 : 1,
            cost: shippingCost,
            failureReason: status === 'FAILED' ? pick(rng, ['NO_ANSWER', 'REFUSED', 'WRONG_ADDRESS'] as const) : null,
            shippedAt: new Date(createdAt.getTime() + 86_400_000),
            deliveredAt: DELIVERED_LIKE.includes(status) ? new Date(createdAt.getTime() + 2 * 86_400_000) : null,
            createdAt: new Date(createdAt.getTime() + 86_400_000),
          },
        });
        shipmentCount += 1;
      }

      // Money: COD collected on delivery, refund on return.
      if (isPaid || isRefunded) {
        const receivedAt = new Date(createdAt.getTime() + 2 * 86_400_000);
        await prisma.payment.create({
          data: { orderId: order.id, method: 'COD', amount: total, status: 'captured', receivedAt, createdAt: receivedAt },
        });
        await prisma.codCollection.create({
          data: {
            orderId: order.id,
            driverId: drivers.length > 0 && wilayaCode === 16 ? pick(rng, drivers).id : null,
            courierId: yalidine?.id,
            amount: total,
            collectedAt: receivedAt,
            reconciledAt: dayOffset > 10 ? new Date(receivedAt.getTime() + 5 * 86_400_000) : null,
          },
        });
        await prisma.ledgerEntry.create({
          data: { kind: 'cod_collection', account: 'courier', amount: total, orderId: order.id, occurredAt: receivedAt },
        });
      }
      if (isRefunded) {
        const refundedAt = new Date(createdAt.getTime() + 6 * 86_400_000);
        await prisma.refund.create({
          data: { orderId: order.id, amount: total, reason: 'Retour client', createdAt: refundedAt },
        });
        await prisma.ledgerEntry.create({
          data: { kind: 'refund', account: 'cash', amount: -total, orderId: order.id, occurredAt: refundedAt },
        });
      }

      // Stock ledger: reserve then deduct, restock on cancel or return.
      if (!['PENDING', 'CANCELLED'].includes(status)) {
        for (const { variant, quantity } of lines) {
          const level = await prisma.inventoryLevel.findUnique({
            where: { variantId_locationId: { variantId: variant.id, locationId: mainLocation.id } },
          });
          const balanceAfter = Math.max((level?.onHand ?? 0) - quantity, 0);
          await prisma.stockMovement.create({
            data: {
              variantId: variant.id,
              locationId: mainLocation.id,
              quantity: -quantity,
              reason: 'SALE',
              referenceType: 'order',
              referenceId: order.id,
              balanceAfter,
              createdAt,
            },
          });
        }
      }

      // Loyalty: 1 point per 100 DA on delivered orders (PRD Section 6.5).
      if (status === 'DELIVERED') {
        const points = Math.floor(Number(total) / 10000);
        const updated = await prisma.customer.update({
          where: { id: customerId },
          data: { loyaltyPoints: { increment: points } },
        });
        await prisma.loyaltyTransaction.create({
          data: {
            customerId,
            orderId: order.id,
            points,
            kind: 'earn',
            balanceAfter: updated.loyaltyPoints,
            createdAt: new Date(createdAt.getTime() + 2 * 86_400_000),
          },
        });
      }
    }
  }
  log('orders', orderCount);
  log('shipments', shipmentCount);

  await refreshCustomerRollups(prisma);
  await seedDeliveryRuns(prisma, rng);
  await seedReviews(prisma, rng);
  await seedAbandonedCarts(prisma, rng);
  await seedFinance(prisma, ownerId, rng);
  await seedSuppliers(prisma);
  await rebuildDailyStats(prisma);
}

/**
 * Demo trading data is generated, not upserted, so a re-run must start from a clean
 * slate or order numbers collide. Catalog, geography and settings are left alone.
 */
async function clearDemoData(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.order.count();
  if (existing === 0) return;

  // Order matters only where there is no cascade from the parent below.
  await prisma.$transaction([
    prisma.dailyStat.deleteMany({}),
    prisma.ledgerEntry.deleteMany({}),
    prisma.loyaltyTransaction.deleteMany({}),
    prisma.stockMovement.deleteMany({ where: { referenceType: 'order' } }),
    prisma.courierSettlementLine.deleteMany({}),
    prisma.courierSettlement.deleteMany({}),
    prisma.deliveryRunStop.deleteMany({}),
    prisma.deliveryRun.deleteMany({}),
    prisma.review.deleteMany({}),
    prisma.promoUsage.deleteMany({}),
    prisma.promotion.updateMany({ data: { usageCount: 0 } }),
    prisma.abandonedCart.deleteMany({}),
    prisma.cart.deleteMany({}),
    prisma.order.deleteMany({}),
    prisma.expense.deleteMany({}),
    prisma.adSpend.deleteMany({}),
  ]);
  await prisma.customer.updateMany({
    data: {
      ordersCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      lifetimeValue: 0n,
      loyaltyPoints: 0,
      firstOrderAt: null,
      lastOrderAt: null,
    },
  });
  log('cleared previous demo data', existing);
}

async function seedPromotions(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  const promotions = [
    {
      name: 'Bienvenue -10 %',
      code: 'BIENVENUE10',
      type: 'PERCENTAGE' as const,
      scope: 'ORDER' as const,
      percentOff: 10,
      firstOrderOnly: true,
      usageLimitPerCustomer: 1,
      priority: 50,
    },
    {
      name: 'Livraison offerte dès 6 000 DA',
      code: null,
      type: 'FREE_SHIPPING' as const,
      scope: 'SHIPPING' as const,
      minSubtotal: 600000n,
      stackable: true,
      priority: 10,
    },
    {
      name: 'Flash Heritage -30 %',
      code: 'HERITAGE30',
      type: 'PERCENTAGE' as const,
      scope: 'COLLECTION' as const,
      percentOff: 30,
      showCountdown: true,
      startsAt: new Date(now - 2 * 86_400_000),
      endsAt: new Date(now + 5 * 86_400_000),
      priority: 20,
    },
    {
      name: 'Pack 3 casquettes',
      code: 'PACK3',
      type: 'BUY_X_GET_Y' as const,
      scope: 'ORDER' as const,
      buyXGetY: { buyQuantity: 2, getQuantity: 1, getDiscountPercent: 50 },
      priority: 30,
    },
    {
      name: 'Palier fidélité',
      code: null,
      type: 'TIERED' as const,
      scope: 'ORDER' as const,
      tiers: [
        { minSubtotal: '800000', percentOff: 5 },
        { minSubtotal: '1500000', percentOff: 10 },
        { minSubtotal: '2500000', percentOff: 15 },
      ],
      priority: 60,
    },
    {
      name: 'Influenceuse — Lina',
      code: 'LINA15',
      type: 'PERCENTAGE' as const,
      scope: 'ORDER' as const,
      percentOff: 15,
      usageLimitTotal: 500,
      priority: 40,
    },
  ];

  for (const promotion of promotions) {
    const existing = promotion.code
      ? await prisma.promotion.findUnique({ where: { code: promotion.code } })
      : await prisma.promotion.findFirst({ where: { name: promotion.name } });
    if (existing) continue;
    await prisma.promotion.create({ data: promotion as never });
  }
  log('promotions', promotions.length);

  const heritage = await prisma.promotion.findUnique({ where: { code: 'HERITAGE30' } });
  const heritageCollection = await prisma.collection.findUnique({ where: { slug: 'heritage' } });
  if (heritage && heritageCollection) {
    await prisma.promotionCollection.upsert({
      where: { promotionId_collectionId: { promotionId: heritage.id, collectionId: heritageCollection.id } },
      create: { promotionId: heritage.id, collectionId: heritageCollection.id },
      update: {},
    });
  }

  const affiliate = await prisma.promotion.findUnique({ where: { code: 'LINA15' } });
  if (affiliate) {
    await prisma.affiliate.upsert({
      where: { handle: 'lina.style' },
      create: { handle: 'lina.style', name: 'Lina Cherifi', promotionId: affiliate.id, commissionPercent: 8 },
      update: {},
    });
  }
}

async function refreshCustomerRollups(prisma: PrismaClient): Promise<void> {
  const grouped = await prisma.order.groupBy({
    by: ['customerId'],
    where: { customerId: { not: null } },
    _count: { _all: true },
    _sum: { total: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });

  for (const row of grouped) {
    if (!row.customerId) continue;
    const delivered = await prisma.order.count({ where: { customerId: row.customerId, status: 'DELIVERED' } });
    const failed = await prisma.order.count({ where: { customerId: row.customerId, status: 'FAILED' } });
    const cancelled = await prisma.order.count({ where: { customerId: row.customerId, status: 'CANCELLED' } });
    const lifetimeValue = await prisma.order.aggregate({
      where: { customerId: row.customerId, status: 'DELIVERED' },
      _sum: { total: true },
    });

    const orders = row._count._all;
    const segment =
      (lifetimeValue._sum.total ?? 0n) > 2_000_000n ? 'VIP' : orders > 1 ? 'RETURNING' : failed > 1 ? 'AT_RISK' : 'NEW';

    await prisma.customer.update({
      where: { id: row.customerId },
      data: {
        ordersCount: orders,
        deliveredCount: delivered,
        failedCount: failed,
        cancelledCount: cancelled,
        lifetimeValue: lifetimeValue._sum.total ?? 0n,
        firstOrderAt: row._min.createdAt,
        lastOrderAt: row._max.createdAt,
        segment: segment as never,
      },
    });
  }
  log('customer rollups', grouped.length);
}

async function seedDeliveryRuns(prisma: PrismaClient, rng: () => number): Promise<void> {
  const drivers = await prisma.driver.findMany({ select: { id: true } });
  const vehicles = await prisma.vehicle.findMany({ select: { id: true } });
  if (drivers.length === 0) return;

  let runCount = 0;
  for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
    const date = startOfDayUtc(daysAgo(dayOffset));
    for (const [index, driver] of drivers.entries()) {
      const orders = await prisma.order.findMany({
        where: {
          wilayaCode: 16,
          status: dayOffset === 0 ? { in: ['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'] } : { in: ['DELIVERED', 'FAILED'] },
          runStops: { none: {} },
        },
        take: 6,
        select: { id: true, total: true, status: true },
      });
      if (orders.length === 0) continue;

      const expectedCash = orders.reduce((sum, order) => sum + order.total, 0n);
      const collectedCash = orders
        .filter((order) => order.status === 'DELIVERED')
        .reduce((sum, order) => sum + order.total, 0n);

      const run = await prisma.deliveryRun.create({
        data: {
          code: `RUN-${date.toISOString().slice(5, 10).replace('-', '')}-${index + 1}`,
          date,
          driverId: driver.id,
          vehicleId: vehicles.length > 0 ? pick(rng, vehicles).id : null,
          status: dayOffset === 0 ? 'IN_PROGRESS' : 'COMPLETED',
          expectedCash,
          collectedCash: dayOffset === 0 ? 0n : collectedCash,
          startedAt: new Date(date.getTime() + 8 * 3600_000),
          endedAt: dayOffset === 0 ? null : new Date(date.getTime() + 17 * 3600_000),
        },
      });

      for (const [position, order] of orders.entries()) {
        await prisma.deliveryRunStop.create({
          data: {
            runId: run.id,
            orderId: order.id,
            position,
            status: dayOffset === 0 ? 'PENDING' : order.status === 'DELIVERED' ? 'DELIVERED' : 'FAILED',
            cashCollected: order.status === 'DELIVERED' && dayOffset > 0 ? order.total : 0n,
            failureReason: order.status === 'FAILED' ? 'NO_ANSWER' : null,
            completedAt: dayOffset === 0 ? null : new Date(date.getTime() + (10 + position) * 3600_000),
          },
        });
      }
      runCount += 1;
    }
  }
  log('delivery runs', runCount);

  // Courier settlement for the closed period (F-AD-64).
  const yalidine = await prisma.courier.findUnique({ where: { slug: 'yalidine' } });
  if (!yalidine) return;
  const periodFrom = startOfDayUtc(daysAgo(37));
  const periodTo = startOfDayUtc(daysAgo(30));
  const settled = await prisma.order.findMany({
    where: { status: 'DELIVERED', deliveredAt: { gte: periodFrom, lte: periodTo } },
    select: { id: true, total: true, shippingCost: true },
    take: 200,
  });
  if (settled.length === 0) return;

  const gross = settled.reduce((sum, order) => sum + order.total, 0n);
  const fees = settled.reduce((sum, order) => sum + order.shippingCost + order.total / 100n, 0n);
  const settlement = await prisma.courierSettlement.create({
    data: {
      courierId: yalidine.id,
      reference: `SET-${periodTo.toISOString().slice(0, 10)}`,
      periodFrom,
      periodTo,
      status: 'PAID',
      grossAmount: gross,
      feesAmount: fees,
      netAmount: gross - fees,
      paidAmount: gross - fees,
      difference: 0n,
      paidAt: new Date(periodTo.getTime() + 7 * 86_400_000),
      lines: {
        create: settled.map((order) => ({
          orderId: order.id,
          codAmount: order.total,
          feeAmount: order.shippingCost + order.total / 100n,
          netAmount: order.total - order.shippingCost - order.total / 100n,
        })),
      },
    },
  });
  log('courier settlement lines', settled.length);
  void settlement;
}

async function seedReviews(prisma: PrismaClient, rng: () => number): Promise<void> {
  const bodies = [
    'Exactement la coupe que je cherchais, la visière ne se déforme pas.',
    'Livrée en deux jours à Alger, emballage propre. Je recommande.',
    'La matière est vraiment bonne pour le prix. Le patch est bien cousu.',
    'Un peu plus grande que prévu mais le réglage rattrape.',
    'Troisième commande, toujours la même qualité.',
    'Le coloris est plus foncé que sur la photo, mais ça me va très bien.',
    'Portée tout l’été, elle n’a pas bougé.',
    'Le paiement à la livraison a bien fonctionné, livreur ponctuel.',
  ];

  const delivered = await prisma.order.findMany({
    where: { status: 'DELIVERED' },
    take: 90,
    select: { id: true, customerId: true, customerName: true, items: { select: { variantId: true } } },
  });

  let count = 0;
  for (const order of delivered) {
    if (rng() > 0.45) continue;
    const variantId = order.items[0]?.variantId;
    if (!variantId) continue;
    const variant = await prisma.variant.findUnique({ where: { id: variantId }, select: { productId: true } });
    if (!variant) continue;

    const rating = rng() < 0.72 ? 5 : rng() < 0.85 ? 4 : rng() < 0.95 ? 3 : 2;
    await prisma.review.create({
      data: {
        productId: variant.productId,
        customerId: order.customerId,
        orderId: order.id,
        rating,
        body: pick(rng, bodies),
        authorName: order.customerName.split(' ')[0] ?? 'Client',
        // A moderation queue with nothing in it teaches an operator nothing, so the
        // demo data leaves a realistic mix waiting and a few already turned away.
        status: rng() < 0.78 ? 'APPROVED' : rng() < 0.85 ? 'REJECTED' : 'PENDING',
        verified: true,
      },
    });
    count += 1;
  }

  // Refresh the denormalized rating used by product cards.
  const grouped = await prisma.review.groupBy({
    by: ['productId'],
    where: { status: 'APPROVED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const row of grouped) {
    await prisma.product.update({
      where: { id: row.productId },
      data: { ratingAverage: row._avg.rating ?? 0, ratingCount: row._count._all },
    });
  }
  log('reviews', count);
}

async function seedAbandonedCarts(prisma: PrismaClient, rng: () => number): Promise<void> {
  const variants = await prisma.variant.findMany({ take: 40, select: { id: true, price: true } });
  const customers = await prisma.customer.findMany({ take: 30, select: { id: true, phone: true, fullName: true } });
  if (variants.length === 0) return;

  let count = 0;
  for (const [index, customer] of customers.entries()) {
    if (rng() > 0.45) continue;
    const createdAt = daysAgo(intBetween(rng, 0, 10), intBetween(rng, 9, 21));
    const items = Array.from({ length: intBetween(rng, 1, 3) }, () => pick(rng, variants));
    const subtotal = items.reduce((sum, item) => sum + item.price, 0n);

    const cart = await prisma.cart.create({
      data: {
        token: `seed-cart-${index}-${createdAt.getTime()}`,
        customerId: customer.id,
        wilayaCode: weightedWilaya(rng),
        createdAt,
        updatedAt: createdAt,
        items: {
          create: items.map((item) => ({ variantId: item.id, quantity: 1, unitPrice: item.price })),
        },
      },
    });

    await prisma.abandonedCart.create({
      data: {
        cartId: cart.id,
        customerId: customer.id,
        phone: customer.phone,
        fullName: customer.fullName,
        itemCount: items.length,
        subtotal,
        recoveryCode: `REVIENS${String(index).padStart(3, '0')}`,
        contactedAt: rng() < 0.35 ? new Date(createdAt.getTime() + 86_400_000) : null,
        createdAt,
      },
    });
    count += 1;
  }
  log('abandoned carts', count);
}

async function seedFinance(prisma: PrismaClient, ownerId: string, rng: () => number): Promise<void> {
  const categories = [
    { slug: 'loyer', fr: 'Loyer', ar: 'الإيجار', en: 'Rent', color: '#8A8A8E' },
    { slug: 'publicite', fr: 'Publicité', ar: 'الإشهار', en: 'Advertising', color: '#D9B36A' },
    { slug: 'salaires', fr: 'Salaires', ar: 'الأجور', en: 'Salaries', color: '#4A5334' },
    { slug: 'emballage', fr: 'Emballage', ar: 'التغليف', en: 'Packaging', color: '#B07A45' },
    { slug: 'carburant', fr: 'Carburant', ar: 'الوقود', en: 'Fuel', color: '#9C3B23' },
    { slug: 'divers', fr: 'Divers', ar: 'متفرقات', en: 'Misc', color: '#1B2A45' },
  ];
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const row = await prisma.expenseCategory.upsert({
      where: { slug: category.slug },
      create: { slug: category.slug, name: tr(category.fr, category.ar, category.en), color: category.color },
      update: {},
    });
    categoryIds.set(category.slug, row.id);
  }

  // Three months of recurring and one-off expenses.
  let expenseCount = 0;
  for (let monthOffset = 2; monthOffset >= 0; monthOffset -= 1) {
    const day = daysAgo(monthOffset * 30 + 1);
    const monthly: Array<[string, number, string]> = [
      ['loyer', 45_000, 'Loyer atelier et stock'],
      ['salaires', 62_000, 'Salaires équipe'],
      ['emballage', 12_000, 'Cartons, pochettes, stickers'],
      ['carburant', 9_000, 'Carburant fourgon'],
      ['divers', 5_000, 'Frais divers'],
    ];
    for (const [slug, amount, label] of monthly) {
      await prisma.expense.create({
        data: {
          categoryId: categoryIds.get(slug),
          label,
          amount: dzd(amount),
          incurredAt: day,
          recurrence: 'monthly',
          createdById: ownerId,
        },
      });
      expenseCount += 1;
    }
  }
  log('expenses', expenseCount);

  // Daily ad spend, which the ROAS report divides into revenue (F-AD-73).
  let adRows = 0;
  for (let dayOffset = 74; dayOffset >= 0; dayOffset -= 1) {
    const spentOn = startOfDayUtc(daysAgo(dayOffset));
    for (const platform of ['meta', 'tiktok'] as const) {
      const base = platform === 'meta' ? 1800 : 900;
      const amount = dzd(base + Math.round(rng() * base * 0.6));
      await prisma.adSpend.upsert({
        where: { platform_campaign_spentOn: { platform, campaign: 'always-on', spentOn } },
        create: {
          platform,
          campaign: 'always-on',
          spentOn,
          amount,
          impressions: intBetween(rng, 20_000, 90_000),
          clicks: intBetween(rng, 300, 1800),
        },
        update: {},
      });
      adRows += 1;
    }
  }
  log('ad spend rows', adRows);
}

async function seedSuppliers(prisma: PrismaClient): Promise<void> {
  const suppliers = [
    { name: 'Atelier Textile Boufarik', contactName: 'M. Hamdi', phone: '+213661220011', email: 'contact@atelier-boufarik.dz' },
    { name: 'Broderie Sétif Pro', contactName: 'Mme Kaci', phone: '+213551330022', email: 'commandes@broderiesetif.dz' },
    { name: 'Import Cuir Oran', contactName: 'M. Belhadj', phone: '+213771440033', email: 'import@cuiroran.dz' },
  ];
  for (const supplier of suppliers) {
    const existing = await prisma.supplier.findFirst({ where: { name: supplier.name } });
    if (!existing) await prisma.supplier.create({ data: supplier });
  }
  log('suppliers', suppliers.length);
}

/**
 * Rebuild the pre-aggregated dashboard table (PRD Section 10.7). The worker owns this
 * nightly in production; the seed runs the same arithmetic so charts render immediately.
 */
export async function rebuildDailyStats(prisma: PrismaClient): Promise<void> {
  const orders = await prisma.order.findMany({
    select: {
      createdAt: true,
      deliveredAt: true,
      status: true,
      total: true,
      cogsTotal: true,
      shippingCost: true,
      discountTotal: true,
      refundedTotal: true,
      customerId: true,
    },
  });

  interface Bucket {
    ordersCount: number;
    deliveredCount: number;
    failedCount: number;
    cancelledCount: number;
    revenue: bigint;
    cogs: bigint;
    shippingCost: bigint;
    discounts: bigint;
    refunds: bigint;
  }
  const buckets = new Map<string, Bucket>();
  const blank = (): Bucket => ({
    ordersCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    revenue: 0n,
    cogs: 0n,
    shippingCost: 0n,
    discounts: 0n,
    refunds: 0n,
  });

  for (const order of orders) {
    const placedKey = order.createdAt.toISOString().slice(0, 10);
    const placed = buckets.get(placedKey) ?? blank();
    placed.ordersCount += 1;
    placed.discounts += order.discountTotal;
    if (order.status === 'FAILED') placed.failedCount += 1;
    if (order.status === 'CANCELLED') placed.cancelledCount += 1;
    buckets.set(placedKey, placed);

    // Revenue lands on the delivery date, not the order date — that is when the cash exists.
    if (order.status === 'DELIVERED' && order.deliveredAt) {
      const deliveredKey = order.deliveredAt.toISOString().slice(0, 10);
      const delivered = buckets.get(deliveredKey) ?? blank();
      delivered.deliveredCount += 1;
      delivered.revenue += order.total;
      delivered.cogs += order.cogsTotal;
      delivered.shippingCost += order.shippingCost;
      buckets.set(deliveredKey, delivered);
    }
    if (order.refundedTotal > 0n && order.deliveredAt) {
      const key = order.deliveredAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? blank();
      bucket.refunds += order.refundedTotal;
      buckets.set(key, bucket);
    }
  }

  const expenses = await prisma.expense.groupBy({ by: ['incurredAt'], _sum: { amount: true } });
  const expenseByDay = new Map(expenses.map((e) => [e.incurredAt.toISOString().slice(0, 10), e._sum.amount ?? 0n]));
  const adSpend = await prisma.adSpend.groupBy({ by: ['spentOn'], _sum: { amount: true } });
  const adByDay = new Map(adSpend.map((a) => [a.spentOn.toISOString().slice(0, 10), a._sum.amount ?? 0n]));
  const newCustomers = await prisma.customer.groupBy({ by: ['firstOrderAt'], _count: { _all: true } });
  const newByDay = new Map<string, number>();
  for (const row of newCustomers) {
    if (!row.firstOrderAt) continue;
    const key = row.firstOrderAt.toISOString().slice(0, 10);
    newByDay.set(key, (newByDay.get(key) ?? 0) + row._count._all);
  }

  const days = new Set([...buckets.keys(), ...expenseByDay.keys(), ...adByDay.keys()]);
  for (const day of days) {
    const bucket = buckets.get(day) ?? blank();
    const dayExpenses = expenseByDay.get(day) ?? 0n;
    const dayAds = adByDay.get(day) ?? 0n;
    const grossProfit = bucket.revenue - bucket.cogs - bucket.shippingCost - bucket.refunds;
    const netProfit = grossProfit - dayExpenses - dayAds;

    await prisma.dailyStat.upsert({
      where: { day: new Date(`${day}T00:00:00.000Z`) },
      create: {
        day: new Date(`${day}T00:00:00.000Z`),
        ordersCount: bucket.ordersCount,
        deliveredCount: bucket.deliveredCount,
        failedCount: bucket.failedCount,
        cancelledCount: bucket.cancelledCount,
        revenue: bucket.revenue,
        cogs: bucket.cogs,
        shippingCost: bucket.shippingCost,
        discounts: bucket.discounts,
        refunds: bucket.refunds,
        expenses: dayExpenses,
        adSpend: dayAds,
        grossProfit,
        netProfit,
        newCustomers: newByDay.get(day) ?? 0,
      },
      update: {
        ordersCount: bucket.ordersCount,
        deliveredCount: bucket.deliveredCount,
        failedCount: bucket.failedCount,
        cancelledCount: bucket.cancelledCount,
        revenue: bucket.revenue,
        cogs: bucket.cogs,
        shippingCost: bucket.shippingCost,
        discounts: bucket.discounts,
        refunds: bucket.refunds,
        expenses: dayExpenses,
        adSpend: dayAds,
        grossProfit,
        netProfit,
      },
    });
  }
  log('daily stats', days.size);
}
