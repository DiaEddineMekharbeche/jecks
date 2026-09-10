import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@jecks/db';
import { CUSTOMER_ERRORS, type LoyaltyAdjustInput } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  DEFAULT_LOYALTY_POLICY,
  applyMovement,
  balanceValue,
  pointsForOrder,
  redeem,
  type LoyaltyPolicy,
  type RedemptionResult,
} from './domain/loyalty.js';

/**
 * Loyalty points — PRD Section 6.5.
 *
 * Points are earned when an order is delivered, never when it is placed. In a
 * cash-on-delivery market a placed order is a request; awarding on checkout would hand
 * points to everyone who refuses the parcel at the door, and points are money.
 *
 * Every movement is a ledger row carrying the balance it produced, so a disputed
 * balance can be walked back rather than argued about.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The policy in force, from settings, falling back to the shipped defaults. */
  async policy(): Promise<LoyaltyPolicy> {
    const [pointsPerDinar, dinarsPerPoint, maxRedemptionPercent, minimumRedemption, expiryDays] =
      await Promise.all([
        this.settings.get<number>('loyalty.points_per_dinar', DEFAULT_LOYALTY_POLICY.pointsPerDinar),
        this.settings.get<number>('loyalty.dinars_per_point', DEFAULT_LOYALTY_POLICY.dinarsPerPoint),
        this.settings.get<number>(
          'loyalty.max_redemption_percent',
          DEFAULT_LOYALTY_POLICY.maxRedemptionPercent,
        ),
        this.settings.get<number>(
          'loyalty.minimum_redemption',
          DEFAULT_LOYALTY_POLICY.minimumRedemption,
        ),
        this.settings.get<number>('loyalty.expiry_days', DEFAULT_LOYALTY_POLICY.expiryDays),
      ]);

    return {
      pointsPerDinar: Number(pointsPerDinar),
      dinarsPerPoint: Number(dinarsPerPoint),
      maxRedemptionPercent: Number(maxRedemptionPercent),
      minimumRedemption: Number(minimumRedemption),
      expiryDays: Number(expiryDays),
    };
  }

  /**
   * Awards the points an order earned on delivery.
   *
   * Idempotent on the order: a second delivery event, a replayed webhook or a manual
   * re-transition finds the existing row and awards nothing more.
   */
  async awardForOrder(orderId: string): Promise<{ points: number; skipped?: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        number: true,
        customerId: true,
        status: true,
        itemsSubtotal: true,
        discountTotal: true,
      },
    });

    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found' });
    if (!order.customerId) return { points: 0, skipped: 'no customer' };
    if (order.status !== OrderStatus.DELIVERED) return { points: 0, skipped: 'not delivered' };

    const already = await this.prisma.loyaltyTransaction.findFirst({
      where: { orderId: order.id, kind: 'earn' },
      select: { id: true },
    });
    if (already) return { points: 0, skipped: 'already awarded' };

    const policy = await this.policy();
    const points = pointsForOrder(
      { itemsSubtotalMinor: order.itemsSubtotal, discountMinor: order.discountTotal },
      policy,
    );
    if (points <= 0) return { points: 0, skipped: 'nothing to earn' };

    await this.record(order.customerId, points, 'earn', `Commande ${order.number}`, order.id);
    return { points };
  }

  /**
   * Takes back the points an order earned, when it is returned or refunded.
   *
   * The balance is floored at zero rather than going negative: a customer who has spent
   * their points cannot owe them back, and a negative balance breaks every screen that
   * shows one.
   */
  async reverseForOrder(orderId: string): Promise<{ points: number }> {
    const earned = await this.prisma.loyaltyTransaction.findFirst({
      where: { orderId, kind: 'earn' },
      select: { id: true, customerId: true, points: true },
    });
    if (!earned) return { points: 0 };

    const reversed = await this.prisma.loyaltyTransaction.findFirst({
      where: { orderId, kind: 'adjust', points: { lt: 0 } },
      select: { id: true },
    });
    if (reversed) return { points: 0 };

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { number: true },
    });

    await this.record(
      earned.customerId,
      -earned.points,
      'adjust',
      `Retour de la commande ${order?.number ?? ''}`.trim(),
      orderId,
    );

    return { points: -earned.points };
  }

  /** What a customer may spend on an order right now, and what it is worth. */
  async quote(
    customerId: string,
    points: number,
    payableMinor: bigint,
  ): Promise<RedemptionResult & { balance: number }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Customer not found' });

    const policy = await this.policy();
    const result = redeem({ points, balance: customer.loyaltyPoints, payableMinor }, policy);

    return { ...result, balance: customer.loyaltyPoints };
  }

  /** Spends points against an order, after the quote has been accepted. */
  async spend(customerId: string, points: number, orderId: string, orderNumber: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Customer not found' });

    if (points > customer.loyaltyPoints) {
      throw new BadRequestException({
        code: CUSTOMER_ERRORS.INSUFFICIENT_POINTS,
        message: 'Solde de points insuffisant',
      });
    }

    await this.record(customerId, -points, 'redeem', `Commande ${orderNumber}`, orderId);
  }

  /** A manual correction, which always carries a reason. */
  async adjust(customerId: string, input: LoyaltyAdjustInput): Promise<{ balance: number }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Customer not found' });

    const balance = await this.record(customerId, input.points, 'adjust', input.note, null);
    return { balance };
  }

  /**
   * Expires balances nobody has touched for the configured window.
   *
   * Runs nightly. Expiry is off by default: silently deleting points a customer earned
   * is the kind of thing a shop should have to switch on deliberately.
   */
  async expireStale(now: Date = new Date()): Promise<{ customers: number; points: number }> {
    const policy = await this.policy();
    if (policy.expiryDays <= 0) return { customers: 0, points: 0 };

    const cutoff = new Date(now.getTime() - policy.expiryDays * 86_400_000);

    const stale = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        loyaltyPoints: { gt: 0 },
        OR: [{ lastOrderAt: { lt: cutoff } }, { lastOrderAt: null, createdAt: { lt: cutoff } }],
      },
      select: { id: true, loyaltyPoints: true },
      take: 1000,
    });

    let points = 0;
    for (const customer of stale) {
      // A customer whose points moved recently is not stale, whatever their orders say.
      const recent = await this.prisma.loyaltyTransaction.findFirst({
        where: { customerId: customer.id, createdAt: { gte: cutoff } },
        select: { id: true },
      });
      if (recent) continue;

      await this.record(
        customer.id,
        -customer.loyaltyPoints,
        'expire',
        `Points expirés après ${policy.expiryDays} jours`,
        null,
      );
      points += customer.loyaltyPoints;
    }

    return { customers: stale.length, points };
  }

  /** What a balance is worth, for the customer screen. */
  async valueOf(points: number): Promise<string> {
    return balanceValue(points, await this.policy()).toString();
  }

  /**
   * Writes one movement and the balance it produced.
   *
   * The row and the cached balance move together in a transaction: a ledger that
   * disagrees with the number on the customer card is worse than either alone.
   */
  private async record(
    customerId: string,
    points: number,
    kind: 'earn' | 'redeem' | 'adjust' | 'expire',
    note: string,
    orderId: string | null,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { loyaltyPoints: true },
      });

      const balanceAfter = applyMovement(customer.loyaltyPoints, points);

      await tx.loyaltyTransaction.create({
        data: {
          customerId,
          orderId,
          points,
          kind,
          note: note.slice(0, 300),
          balanceAfter,
        },
      });

      await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balanceAfter } });
      return balanceAfter;
    });
  }
}
