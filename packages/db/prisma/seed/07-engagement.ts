import type { PrismaClient } from '@prisma/client';
import { daysAgo, intBetween, log, makeRng, pick, pickMany } from './util.js';

/**
 * Shopper-side demo data — wishlists, back-in-stock requests, newsletter subscribers,
 * contact messages and analytics events.
 *
 * The point is that the M2 storefront screens and the M5/M6 admin reports open with
 * something in them: an empty funnel chart and an empty subscriber list teach an
 * operator nothing about whether the feature works.
 */

const MESSAGES = [
  {
    subject: 'Disponibilité taille L',
    body: "Bonjour, la casquette Atlas en noir sera-t-elle réapprovisionnée en L ? Merci d'avance.",
  },
  {
    subject: 'Livraison Tamanrasset',
    body: 'Est-ce que vous livrez à Tamanrasset et sous quel délai ? Je voudrais commander deux pièces.',
  },
  {
    subject: 'Retour article',
    body: "J'ai reçu ma commande hier mais la taille ne convient pas. Comment faire pour l'échanger ?",
  },
  {
    subject: '',
    body: 'Bravo pour la qualité, la deuxième casquette tient encore mieux que la première.',
  },
  {
    subject: 'Commande en gros',
    body: 'Nous sommes une association sportive à Oran, nous cherchons 40 casquettes brodées. Tarif possible ?',
  },
];

const ANALYTICS_PATHS = [
  '/fr',
  '/fr/collections/nouveautes',
  '/fr/collections/meilleures-ventes',
  '/fr/search',
  '/fr/track',
];

const SEARCH_TERMS = [
  'casquette noire',
  'trucker',
  'bob',
  'snapback',
  'kaskita',
  'beanie hiver',
  'casquette cuir',
];

export async function seedEngagement(prisma: PrismaClient): Promise<void> {
  const rng = makeRng(0x5eed_beef);

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    take: 60,
    select: { id: true, phone: true, email: true, fullName: true },
  });
  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, variants: { select: { id: true }, take: 3 } },
  });

  if (customers.length === 0 || products.length === 0) {
    log('engagement skipped', 'no customers or products');
    return;
  }

  // --- wishlists -------------------------------------------------------------

  if ((await prisma.wishlistItem.count()) === 0) {
    let wishlisted = 0;
    for (const customer of customers.slice(0, 25)) {
      for (const product of pickMany(rng, products, intBetween(rng, 1, 4))) {
        await prisma.wishlistItem
          .create({ data: { customerId: customer.id, productId: product.id } })
          // A duplicate pick simply means this shopper already hearted it.
          .catch(() => undefined);
        wishlisted += 1;
      }
    }
    log('wishlist items', wishlisted);
  }

  // --- back in stock ---------------------------------------------------------

  if ((await prisma.stockNotification.count()) === 0) {
    // Requests attach to variants that are actually out of stock, so the worker's
    // back-in-stock job has something real to find when a receipt arrives.
    const outOfStock = await prisma.inventoryLevel.findMany({
      where: { onHand: { lte: 0 } },
      take: 12,
      select: { variantId: true, variant: { select: { productId: true } } },
    });

    for (const level of outOfStock) {
      const customer = pick(rng, customers);
      await prisma.stockNotification.create({
        data: {
          productId: level.variant.productId,
          variantId: level.variantId,
          customerId: customer.id,
          phone: customer.phone,
          createdAt: daysAgo(intBetween(rng, 1, 30)),
        },
      });
    }
    log('stock notifications', outOfStock.length);
  }

  // --- newsletter ------------------------------------------------------------

  if ((await prisma.newsletterSubscriber.count()) === 0) {
    let subscribed = 0;
    for (const customer of customers) {
      if (rng() > 0.55) continue;
      await prisma.newsletterSubscriber
        .create({
          data: {
            email: customer.email,
            phone: customer.email ? null : customer.phone,
            locale: rng() < 0.7 ? 'fr' : 'ar',
            source: pick(rng, ['footer', 'home', 'checkout']),
            confirmedAt: daysAgo(intBetween(rng, 1, 120)),
            // A list with no unsubscribes looks fake, and the export needs to prove it
            // excludes them.
            unsubscribedAt: rng() < 0.08 ? daysAgo(intBetween(rng, 1, 20)) : null,
            createdAt: daysAgo(intBetween(rng, 1, 120)),
          },
        })
        .catch(() => undefined);
      subscribed += 1;
    }
    log('newsletter subscribers', subscribed);
  }

  // --- contact messages ------------------------------------------------------

  if ((await prisma.contactMessage.count()) === 0) {
    for (const [index, message] of MESSAGES.entries()) {
      const customer = pick(rng, customers);
      await prisma.contactMessage.create({
        data: {
          name: customer.fullName,
          email: customer.email,
          phone: customer.phone,
          subject: message.subject || null,
          body: message.body,
          // The two oldest are answered; the rest are what the owner opens to.
          readAt: index < 2 ? daysAgo(index + 1) : null,
          repliedAt: index < 2 ? daysAgo(index + 1) : null,
          createdAt: daysAgo(index * 3 + 1),
        },
      });
    }
    log('contact messages', MESSAGES.length);
  }

  // --- analytics -------------------------------------------------------------

  if ((await prisma.analyticsEvent.count()) === 0) {
    const rows: Array<Record<string, unknown>> = [];

    for (let day = 0; day < 45; day += 1) {
      const sessions = intBetween(rng, 20, 60);

      for (let session = 0; session < sessions; session += 1) {
        const sessionId = `seed-${day}-${session}`;
        const at = daysAgo(day, intBetween(rng, 8, 22));
        const device = rng() < 0.72 ? 'mobile' : rng() < 0.9 ? 'desktop' : 'tablet';

        rows.push({
          name: 'page_view',
          sessionId,
          path: pick(rng, ANALYTICS_PATHS),
          device,
          occurredAt: at,
        });

        // A funnel that only ever narrows: views, then some carts, then fewer
        // checkouts, then fewer purchases. Anything else makes the report unreadable.
        if (rng() < 0.55) {
          const product = pick(rng, products);
          rows.push({
            name: 'product_view',
            sessionId,
            productId: product.id,
            device,
            occurredAt: at,
          });

          if (rng() < 0.28) {
            rows.push({
              name: 'add_to_cart',
              sessionId,
              productId: product.id,
              variantId: product.variants[0]?.id ?? null,
              device,
              occurredAt: at,
            });

            if (rng() < 0.45) {
              rows.push({ name: 'checkout_start', sessionId, device, occurredAt: at });
              if (rng() < 0.6) {
                rows.push({ name: 'purchase', sessionId, device, occurredAt: at });
              }
            }
          }
        }

        if (rng() < 0.18) {
          const term = pick(rng, SEARCH_TERMS);
          rows.push({
            name: 'search',
            sessionId,
            query: term,
            // Two of the terms deliberately return nothing, so the zero-result report
            // has rows the owner can act on.
            resultCount: term === 'kaskita' || term === 'casquette cuir' ? 0 : intBetween(rng, 1, 18),
            device,
            occurredAt: at,
          });
        }
      }
    }

    // Chunked: a single createMany of forty thousand rows is a slow transaction.
    for (let index = 0; index < rows.length; index += 2000) {
      await prisma.analyticsEvent.createMany({ data: rows.slice(index, index + 2000) as never });
    }
    log('analytics events', rows.length);
  }
}
