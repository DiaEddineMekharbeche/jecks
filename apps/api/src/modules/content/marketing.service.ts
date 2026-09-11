import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@jecks/db';
import {
  CONTENT_ERRORS,
  type AbandonedCartRow,
  type AbandonedCartStats,
  type AffiliateInput,
  type AffiliateRow,
  type ContactCartInput,
  type NewsletterProviderKey,
  type NewsletterStats,
  type NewsletterSubscriberRow,
  type NewsletterSyncInput,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SettingsAdminService } from '../system/settings-admin.service.js';
import {
  BrevoNewsletterProvider,
  LogNewsletterProvider,
  type NewsletterProvider,
} from './newsletter-provider.js';

/**
 * Marketing — PRD F-AD-91.
 *
 * The newsletter list, the carts nobody finished, and the people paid to send traffic.
 * All three are the same shape of question: who could be sold to, and what happened
 * when somebody tried.
 */
@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);
  private readonly providers: NewsletterProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly secrets: SettingsAdminService,
    private readonly queue: QueueService,
    log: LogNewsletterProvider,
    brevo: BrevoNewsletterProvider,
  ) {
    this.providers = [log, brevo];
  }

  // --- newsletter -----------------------------------------------------------

  async listSubscribers(limit = 500): Promise<NewsletterSubscriberRow[]> {
    const rows = await this.prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      phone: row.phone,
      locale: row.locale,
      source: row.source,
      confirmed: row.confirmedAt !== null,
      unsubscribed: row.unsubscribedAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async newsletterStats(): Promise<NewsletterStats> {
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [total, confirmed, unsubscribed, recent, sources] = await Promise.all([
      this.prisma.newsletterSubscriber.count(),
      this.prisma.newsletterSubscriber.count({ where: { confirmedAt: { not: null } } }),
      this.prisma.newsletterSubscriber.count({ where: { unsubscribedAt: { not: null } } }),
      this.prisma.newsletterSubscriber.count({ where: { createdAt: { gte: since } } }),
      this.prisma.newsletterSubscriber.groupBy({
        by: ['source'],
        _count: { _all: true },
        orderBy: { _count: { source: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      confirmed,
      unsubscribed,
      last30Days: recent,
      bySource: sources.map((row) => ({ source: row.source ?? 'inconnu', count: row._count._all })),
    };
  }

  /**
   * Copies the list to whichever provider is configured.
   *
   * Unsubscribes go out with everyone else rather than being filtered: the provider has
   * to be told somebody left, or the next campaign reaches a person who asked not to be
   * mailed.
   */
  async syncNewsletter(input: NewsletterSyncInput) {
    const key = (await this.settings.get<string>(
      'integrations.newsletter_provider',
      'log',
    )) as NewsletterProviderKey;

    const provider = this.providers.find((entry) => entry.key === key) ?? this.providers[0]!;

    const credentials: Record<string, string> = {};
    for (const name of provider.requiredCredentials) {
      const value = await this.secrets.secret(`integrations.${provider.key}_${name}`);
      if (value) credentials[name] = value;
    }

    const missing = provider.requiredCredentials.filter((name) => !credentials[name]);
    if (missing.length > 0) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.NEWSLETTER_NOT_READY,
        message: `${provider.label} : il manque ${missing.join(', ')}`,
      });
    }

    const subscribers = await this.prisma.newsletterSubscriber.findMany({
      where: input.since ? { createdAt: { gte: input.since } } : {},
      take: 10_000,
      select: {
        email: true,
        phone: true,
        locale: true,
        source: true,
        unsubscribedAt: true,
      },
    });

    return provider.sync(
      subscribers.map((subscriber) => ({
        email: subscriber.email,
        phone: subscriber.phone,
        locale: subscriber.locale,
        source: subscriber.source,
        unsubscribed: subscriber.unsubscribedAt !== null,
      })),
      credentials,
    );
  }

  /** The providers the shop can choose between, for Settings. */
  newsletterProviders() {
    return this.providers.map((provider) => ({
      key: provider.key,
      label: provider.label,
      requiredCredentials: [...provider.requiredCredentials],
    }));
  }

  // --- abandoned carts ------------------------------------------------------

  async listAbandonedCarts(filter: 'open' | 'contacted' | 'recovered' | 'all' = 'open') {
    const rows = await this.prisma.abandonedCart.findMany({
      where:
        filter === 'open'
          ? { contactedAt: null, recoveredOrderId: null }
          : filter === 'contacted'
            ? { contactedAt: { not: null }, recoveredOrderId: null }
            : filter === 'recovered'
              ? { recoveredOrderId: { not: null } }
              : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { customer: { select: { fullName: true, phone: true } } },
    });

    const recoveredIds = rows.map((row) => row.recoveredOrderId).filter(Boolean) as string[];
    const orders = await this.prisma.order.findMany({
      where: { id: { in: recoveredIds } },
      select: { id: true, number: true },
    });
    const orderNumbers = new Map(orders.map((order) => [order.id, order.number]));

    const storefront = await this.settings.get<string>(
      'store.storefront_url',
      process.env.STOREFRONT_URL ?? 'http://localhost:3000',
    );

    return rows.map((row): AbandonedCartRow => ({
      id: row.id,
      cartId: row.cartId,
      customerId: row.customerId,
      fullName: row.fullName ?? row.customer?.fullName ?? null,
      phone: row.phone ?? row.customer?.phone ?? null,
      wilayaCode: row.wilayaCode,
      itemCount: row.itemCount,
      subtotalMinor: row.subtotal.toString(),
      // The link that puts the cart back in front of them, if one was generated.
      recoveryUrl: row.recoveryCode
        ? `${storefront.replace(/\/$/, '')}/fr/panier?recover=${row.recoveryCode}`
        : null,
      contactedAt: row.contactedAt?.toISOString() ?? null,
      recoveredOrderId: row.recoveredOrderId,
      recoveredOrderNumber: row.recoveredOrderId
        ? (orderNumbers.get(row.recoveredOrderId) ?? null)
        : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async abandonedCartStats(): Promise<AbandonedCartStats> {
    const [open, contacted, recovered, openValue, recoveredValue] = await Promise.all([
      this.prisma.abandonedCart.count({ where: { contactedAt: null, recoveredOrderId: null } }),
      this.prisma.abandonedCart.count({ where: { contactedAt: { not: null } } }),
      this.prisma.abandonedCart.count({ where: { recoveredOrderId: { not: null } } }),
      this.prisma.abandonedCart.aggregate({
        where: { contactedAt: null, recoveredOrderId: null },
        _sum: { subtotal: true },
      }),
      this.prisma.abandonedCart.aggregate({
        where: { recoveredOrderId: { not: null } },
        _sum: { subtotal: true },
      }),
    ]);

    return {
      open,
      contacted,
      recovered,
      openValueMinor: (openValue._sum.subtotal ?? 0n).toString(),
      recoveredValueMinor: (recoveredValue._sum.subtotal ?? 0n).toString(),
      // Against contacted, not against every abandoned cart: a cart nobody chased says
      // nothing about whether chasing works.
      recoveryRate: contacted === 0 ? 0 : Math.round((recovered / contacted) * 1000) / 10,
    };
  }

  /**
   * Queues a recovery message for a batch of carts.
   *
   * Marked contacted immediately rather than when the message lands: a queue that
   * retries would otherwise send a second reminder to the same person, and two messages
   * about the same forgotten cart is how a shop earns an unsubscribe.
   */
  async contactCarts(input: ContactCartInput): Promise<{ queued: number; skipped: number }> {
    const carts = await this.prisma.abandonedCart.findMany({
      where: { id: { in: input.cartIds }, contactedAt: null, recoveredOrderId: null },
      select: { id: true, phone: true, customerId: true, customer: { select: { phone: true } } },
    });

    let queued = 0;

    for (const cart of carts) {
      const phone = cart.phone ?? cart.customer?.phone;
      if (!phone) continue;

      await this.prisma.abandonedCart.update({
        where: { id: cart.id },
        data: { contactedAt: new Date() },
      });

      await this.queue
        .enqueue('notifications', 'notification.dispatch', {
          event: 'cart.abandoned',
          abandonedCartId: cart.id,
          phone,
        })
        .catch((error: unknown) => {
          this.logger.warn(`Could not queue a recovery message: ${String(error)}`);
        });

      queued += 1;
    }

    return { queued, skipped: input.cartIds.length - queued };
  }

  // --- affiliates -----------------------------------------------------------

  /**
   * Affiliates, with what their code actually earned.
   *
   * Attribution is the promotion code they hand out, counted on delivered orders only.
   * An influencer whose audience orders and refuses at the door has not sold anything,
   * and paying commission on that is how these arrangements go wrong.
   */
  async listAffiliates(): Promise<AffiliateRow[]> {
    const affiliates = await this.prisma.affiliate.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { promotion: { select: { code: true } } },
    });

    const promotionIds = affiliates.map((affiliate) => affiliate.promotionId).filter(Boolean) as string[];

    const usages = await this.prisma.promoUsage.findMany({
      where: { promotionId: { in: promotionIds } },
      select: {
        promotionId: true,
        order: { select: { status: true, total: true } },
      },
    });

    const byPromotion = new Map<string, { orders: number; revenue: bigint }>();
    for (const usage of usages) {
      if (usage.order?.status !== OrderStatus.DELIVERED) continue;
      const entry = byPromotion.get(usage.promotionId) ?? { orders: 0, revenue: 0n };
      entry.orders += 1;
      entry.revenue += usage.order.total;
      byPromotion.set(usage.promotionId, entry);
    }

    return affiliates.map((affiliate) => {
      const stats = affiliate.promotionId
        ? (byPromotion.get(affiliate.promotionId) ?? { orders: 0, revenue: 0n })
        : { orders: 0, revenue: 0n };

      const percent = Number(affiliate.commissionPercent);
      const commission = (stats.revenue * BigInt(Math.round(percent * 100))) / 10_000n;

      return {
        id: affiliate.id,
        name: affiliate.name,
        handle: affiliate.handle,
        phone: affiliate.phone,
        email: affiliate.email,
        promotionId: affiliate.promotionId,
        promotionCode: affiliate.promotion?.code ?? null,
        commissionPercent: percent,
        active: affiliate.active,
        orders: stats.orders,
        revenueMinor: stats.revenue.toString(),
        commissionMinor: commission.toString(),
        createdAt: affiliate.createdAt.toISOString(),
      };
    });
  }

  async createAffiliate(input: AffiliateInput): Promise<AffiliateRow[]> {
    const existing = await this.prisma.affiliate.findUnique({ where: { handle: input.handle } });
    if (existing) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.HANDLE_TAKEN,
        message: 'Ce pseudo est déjà pris',
        details: { field: 'handle' },
      });
    }

    await this.prisma.affiliate.create({
      data: {
        name: input.name,
        handle: input.handle,
        phone: input.phone ?? null,
        email: input.email ?? null,
        promotionId: input.promotionId ?? null,
        commissionPercent: input.commissionPercent,
        active: input.active,
      },
    });

    return this.listAffiliates();
  }

  async updateAffiliate(id: string, input: AffiliateInput): Promise<AffiliateRow[]> {
    const existing = await this.prisma.affiliate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Affiliate not found' });

    const clash = await this.prisma.affiliate.findFirst({
      where: { handle: input.handle, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.HANDLE_TAKEN,
        message: 'Ce pseudo est déjà pris',
        details: { field: 'handle' },
      });
    }

    await this.prisma.affiliate.update({
      where: { id },
      data: {
        name: input.name,
        handle: input.handle,
        phone: input.phone ?? null,
        email: input.email ?? null,
        promotionId: input.promotionId ?? null,
        commissionPercent: input.commissionPercent,
        active: input.active,
      },
    });

    return this.listAffiliates();
  }

  async removeAffiliate(id: string): Promise<void> {
    await this.prisma.affiliate.deleteMany({ where: { id } });
  }
}
