import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  type AnalyticsBatchInput,
  type ContactInput,
  type NewsletterInput,
  type NotifyMeInput,
  type Translated,
  type WishlistEntry,
  type WishlistItemInput,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Wishlist, back-in-stock alerts, newsletter, contact and analytics — the small write
 * surface of PRD F-ST-31, F-ST-32, F-ST-50 and F-AD-82.
 *
 * They live together because they share one property: each is an anonymous or
 * near-anonymous write from the open internet, so each is deduplicated on the way in
 * rather than cleaned up afterwards.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  // --- wishlist -------------------------------------------------------------

  async listWishlist(customerId: string): Promise<WishlistEntry[]> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        variant: {
          select: {
            name: true,
            price: true,
            compareAtPrice: true,
            inventoryLevels: { select: { onHand: true, reserved: true } },
          },
        },
        product: {
          select: {
            name: true,
            slug: true,
            minPrice: true,
            maxCompareAt: true,
            totalStock: true,
            media: {
              where: { position: 0 },
              take: 1,
              select: { media: { select: { storageKey: true } } },
            },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      productName: row.product.name as Translated,
      productSlug: row.product.slug,
      variantName: row.variant?.name ?? null,
      imageUrl: this.storage.publicUrl(row.product.media[0]?.media.storageKey),
      priceMinor: (row.variant?.price ?? row.product.minPrice).toString(),
      compareAtPriceMinor:
        (row.variant?.compareAtPrice ?? row.product.maxCompareAt)?.toString() ?? null,
      inStock: row.variant
        ? row.variant.inventoryLevels.some((level) => level.onHand - level.reserved > 0)
        : row.product.totalStock > 0,
      addedAt: row.createdAt.toISOString(),
    }));
  }

  /** Idempotent: hearting twice is the same as hearting once. */
  async addToWishlist(customerId: string, input: WishlistItemInput): Promise<WishlistEntry[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }

    await this.prisma.wishlistItem
      .create({
        data: {
          customerId,
          productId: input.productId,
          variantId: input.variantId ?? null,
        },
      })
      .catch((error: unknown) => {
        // A unique-constraint violation means it is already there, which is the state
        // the caller asked for.
        if (!isUniqueViolation(error)) throw error;
      });

    return this.listWishlist(customerId);
  }

  async removeFromWishlist(customerId: string, id: string): Promise<WishlistEntry[]> {
    await this.prisma.wishlistItem.deleteMany({ where: { id, customerId } });
    return this.listWishlist(customerId);
  }

  // --- back in stock --------------------------------------------------------

  /**
   * Records a "tell me when it is back" request — PRD F-ST-32.
   *
   * Registering twice for the same variant is not an error and does not create a second
   * row: the worker would otherwise send the same person two messages.
   */
  async notifyMe(
    input: NotifyMeInput,
    customerId: string | null,
  ): Promise<{ registered: true }> {
    const variantExists = input.variantId
      ? await this.prisma.variant.count({ where: { id: input.variantId, deletedAt: null } })
      : 1;
    if (!variantExists) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That option does not exist' });
    }

    const existing = await this.prisma.stockNotification.findFirst({
      where: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        notifiedAt: null,
        OR: [
          ...(customerId ? [{ customerId }] : []),
          ...(input.phone ? [{ phone: input.phone }] : []),
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
      select: { id: true },
    });

    if (!existing) {
      await this.prisma.stockNotification.create({
        data: {
          productId: input.productId,
          variantId: input.variantId ?? null,
          customerId,
          phone: input.phone ?? null,
          email: input.email ?? null,
        },
      });
    }

    return { registered: true };
  }

  // --- newsletter -----------------------------------------------------------

  /**
   * Subscribes an address or a number. Re-subscribing after an unsubscribe reactivates
   * the row rather than failing on the unique index, which is what a shopper who
   * changed their mind expects.
   */
  async subscribe(input: NewsletterInput): Promise<{ subscribed: true; alreadyKnown: boolean }> {
    const where: Prisma.NewsletterSubscriberWhereInput = input.email
      ? { email: input.email }
      : { phone: input.phone };

    const existing = await this.prisma.newsletterSubscriber.findFirst({ where, select: { id: true, unsubscribedAt: true } });

    if (existing) {
      if (existing.unsubscribedAt) {
        await this.prisma.newsletterSubscriber.update({
          where: { id: existing.id },
          data: { unsubscribedAt: null, locale: input.locale, source: input.source ?? null },
        });
      }
      return { subscribed: true, alreadyKnown: !existing.unsubscribedAt };
    }

    await this.prisma.newsletterSubscriber.create({
      data: {
        email: input.email ?? null,
        phone: input.phone ?? null,
        locale: input.locale,
        source: input.source ?? 'storefront',
        // Single opt-in: the shop can turn on confirmation later without a migration,
        // and an Algerian shopper does not expect a confirmation e-mail.
        confirmedAt: new Date(),
      },
    });

    return { subscribed: true, alreadyKnown: false };
  }

  async unsubscribe(identifier: string): Promise<{ unsubscribed: boolean }> {
    const result = await this.prisma.newsletterSubscriber.updateMany({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
      data: { unsubscribedAt: new Date() },
    });
    return { unsubscribed: result.count > 0 };
  }

  // --- contact --------------------------------------------------------------

  async contact(input: ContactInput): Promise<{ received: true }> {
    await this.prisma.contactMessage.create({
      data: {
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        subject: input.subject ?? null,
        body: input.body,
      },
    });

    // The owner sees it on the dashboard's "needs attention" list without refreshing.
    this.realtime.emit(
      'notification',
      { kind: 'contact', title: 'Nouveau message', from: input.name },
      ['orders.read'],
    );

    return { received: true };
  }

  // --- analytics ------------------------------------------------------------

  /**
   * Server-side events — PRD F-AD-82.
   *
   * Batched, and stored with no personal data beyond a customer id when the shopper is
   * signed in: the session id is random per browser session and is never joined to a
   * person. That is what makes the funnel and the zero-result search report possible
   * without keeping a behavioural profile.
   */
  async track(
    batch: AnalyticsBatchInput,
    customerId: string | null,
  ): Promise<{ accepted: number }> {
    const rows = batch.events.map((event) => ({
      name: event.name,
      sessionId: event.sessionId,
      customerId,
      productId: event.productId ?? null,
      variantId: event.variantId ?? null,
      orderId: event.orderId ?? null,
      path: event.path ?? null,
      referrer: event.referrer ?? null,
      utmSource: event.utmSource ?? null,
      utmMedium: event.utmMedium ?? null,
      utmCampaign: event.utmCampaign ?? null,
      query: event.query ?? null,
      resultCount: event.resultCount ?? null,
      value: event.valueMinor === undefined ? null : BigInt(event.valueMinor),
      device: event.device ?? null,
      wilayaCode: event.wilayaCode ?? null,
      // A client clock can be wrong or forged; a timestamp far from now is replaced.
      occurredAt: plausibleDate(event.occurredAt),
    }));

    const result = await this.prisma.analyticsEvent.createMany({ data: rows });

    // A product view is what makes "most viewed" real; counting it here keeps the
    // rollup in one place rather than in every page that renders a product.
    const viewed = batch.events
      .filter((event) => event.name === 'product_view' && event.productId)
      .map((event) => event.productId!);
    if (viewed.length > 0) {
      await this.prisma.product.updateMany({
        where: { id: { in: [...new Set(viewed)] } },
        data: { viewsCount: { increment: 1 } },
      });
    }

    return { accepted: result.count };
  }
}

/** Clamps a client-supplied timestamp to something that could plausibly be now. */
function plausibleDate(value: Date | undefined): Date {
  const now = new Date();
  if (!value) return now;
  const drift = Math.abs(value.getTime() - now.getTime());
  return drift > 24 * 3_600_000 ? now : value;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
