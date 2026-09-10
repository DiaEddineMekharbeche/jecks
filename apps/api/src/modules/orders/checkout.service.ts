import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@jecks/db';
import {
  DeliveryType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  t,
  type CheckoutInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CartService } from '../cart/cart.service.js';
import { LocationsService } from '../inventory/locations.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { QueueService } from '../queue/queue.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShippingService } from '../shipping/shipping.service.js';
import { assessRisk, looksVague, type RiskPolicy } from './domain/risk.js';
import { computeTotals } from './domain/totals.js';
import { OrderNumberService } from './order-number.service.js';

/**
 * Guest COD checkout — PRD F-ST-42 to F-ST-46, Section 7.
 *
 * One transaction does everything an order is: create or find the customer, snapshot
 * the lines with their price *and their cost*, reserve the stock, record the promo
 * usage, allocate the number. A partial order is worse than no order, so nothing here
 * is allowed to half-succeed.
 *
 * The cart is re-priced from scratch rather than trusted: what the browser last saw is
 * a display, and the amount the customer is asked for on the doorstep is decided here.
 */

export interface CheckoutContext {
  ip: string | null;
  userAgent: string | null;
  customerId: string | null;
  idempotencyKey: string | null;
}

export interface CheckoutResult {
  orderId: string;
  number: string;
  totalMinor: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** Set when an online provider needs the shopper redirected. */
  checkoutUrl: string | null;
  trackingUrl: string;
  requiresReview: boolean;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly promotions: PromotionsService,
    private readonly shipping: ShippingService,
    private readonly settings: SettingsService,
    private readonly ledger: StockLedgerService,
    private readonly locations: LocationsService,
    private readonly numbers: OrderNumberService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  async place(input: CheckoutInput, context: CheckoutContext): Promise<CheckoutResult> {
    // An idempotent replay must return the original order, not a second one. A shopper
    // who double-taps on a slow connection gets one parcel.
    const replay = await this.findReplay(context.idempotencyKey);
    if (replay) return replay;

    const { cart, lines, promo } = await this.cart.forCheckout(
      input.cartToken,
      context.customerId,
      input.shipping.wilayaCode,
      input.shipping.deliveryType,
    );

    const [wilaya, commune] = await Promise.all([
      this.prisma.wilaya.findUnique({
        where: { code: input.shipping.wilayaCode },
        select: { code: true, name: true },
      }),
      this.prisma.commune.findFirst({
        where: { id: input.shipping.communeId, wilayaCode: input.shipping.wilayaCode },
        select: { id: true, name: true },
      }),
    ]);

    if (!wilaya) {
      throw new BadRequestException({
        code: 'NO_SHIPPING_RATE',
        message: 'We do not deliver to that wilaya yet',
      });
    }
    if (!commune) {
      throw new BadRequestException({
        code: 'COMMUNE_MISMATCH',
        message: 'That commune does not belong to the chosen wilaya',
        details: { field: 'shipping.communeId' },
      });
    }

    const variants = await this.loadVariants(lines.map((line) => line.variantId));
    const weightGrams = lines.reduce(
      (sum, line) => sum + (variants.get(line.variantId)?.weightGrams ?? 0) * line.quantity,
      0,
    );

    const quote = await this.shipping.quote({
      wilayaCode: input.shipping.wilayaCode,
      deliveryType: input.shipping.deliveryType,
      weightGrams,
      subtotal: lines.reduce((sum, line) => sum + line.unitPriceMinor * BigInt(line.quantity), 0n),
    });

    const customer = await this.upsertCustomer(input, context);

    const totals = computeTotals({
      lines: lines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        unitCostMinor: variants.get(line.variantId)?.costPrice ?? 0n,
        weightGrams: variants.get(line.variantId)?.weightGrams ?? 0,
      })),
      discountByLine: Object.fromEntries(
        promo.lineDiscounts.map((entry) => [entry.lineId, entry.amountMinor]),
      ),
      shippingMinor: promo.freeShipping ? 0n : quote.price,
      loyaltyPoints: customer ? Math.min(input.loyaltyPointsToRedeem, customer.loyaltyPoints) : 0,
      pointValueMinor: BigInt(await this.settings.get<number>('loyalty.point_value_centimes', 0)),
      loyaltyMaxPercent: await this.settings.get<number>('loyalty.max_order_percent', 20),
      vatPercent: await this.settings.get<number>('tax.vat_percent', 19),
      pricesIncludeTax: await this.settings.get<boolean>('tax.prices_include_tax', true),
    });

    const risk = await this.assess(input, context, customer, totals.totalMinor);

    if (risk.block) {
      throw new ConflictException({
        code: 'ORDER_BLOCKED',
        message: 'We cannot take this order. Please contact us so we can help.',
        details: { flags: risk.flags },
      });
    }
    if (risk.requireCaptcha && !input.captchaToken) {
      throw new BadRequestException({
        code: 'CAPTCHA_REQUIRED',
        message: 'Please confirm you are not a robot',
        details: { flags: risk.flags },
      });
    }

    const locationId = await this.locations.defaultLocationId();
    const autoConfirm = await this.settings.get<boolean>('orders.auto_confirm', false);
    const status = autoConfirm ? OrderStatus.CONFIRMED : OrderStatus.PENDING;
    const deductNow =
      autoConfirm &&
      (await this.settings.get<string>('orders.stock_deduction_moment', 'confirmed')) ===
        'confirmed';

    const pickupPoint = input.shipping.pickupPointId
      ? await this.prisma.pickupPoint.findUnique({
          where: { id: input.shipping.pickupPointId },
          select: { id: true, name: true },
        })
      : null;

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbers.next(tx);

      const created = await tx.order.create({
        data: {
          number,
          customerId: customer?.id ?? null,
          status,
          paymentStatus: PaymentStatus.UNPAID,
          paymentMethod: input.payment.method,
          source: input.source,

          customerName: input.customer.fullName,
          customerPhone: input.customer.phone,
          customerAltPhone: input.customer.altPhone ?? null,
          customerEmail: input.customer.email ?? null,

          wilayaCode: wilaya.code,
          wilayaName: t(wilaya.name as Translated, 'fr'),
          communeId: commune.id,
          communeName: t(commune.name as Translated, 'fr'),
          deliveryType: input.shipping.deliveryType,
          address:
            input.shipping.deliveryType === DeliveryType.HOME
              ? (input.shipping.address ?? null)
              : null,
          pickupPointId: pickupPoint?.id ?? null,
          pickupPointName: pickupPoint?.name ?? null,

          itemsSubtotal: totals.itemsSubtotalMinor,
          discountTotal: totals.discountTotalMinor,
          loyaltyDiscount: totals.loyaltyDiscountMinor,
          shippingTotal: totals.shippingTotalMinor,
          shippingCost: quote.cost,
          taxTotal: totals.taxTotalMinor,
          total: totals.totalMinor,
          cogsTotal: totals.cogsTotalMinor,

          weightGrams: totals.weightGrams,
          itemCount: totals.itemCount,
          note: input.shipping.note ?? null,
          riskScore: risk.score,
          riskFlags: risk.flags as unknown as Prisma.InputJsonValue,

          utmSource: input.utm?.source ?? null,
          utmMedium: input.utm?.medium ?? null,
          utmCampaign: input.utm?.campaign ?? null,
          utmContent: input.utm?.content ?? null,
          utmTerm: input.utm?.term ?? null,
          idempotencyKey: context.idempotencyKey,
          ip: context.ip,

          stockReserved: !deductNow,
          stockDeducted: deductNow,
          confirmedAt: autoConfirm ? new Date() : null,

          items: {
            create: lines.map((line) => {
              const variant = variants.get(line.variantId)!;
              const discount = totals.lineDiscounts[line.id] ?? 0n;
              return {
                variantId: line.variantId,
                // Snapshotted, not joined: a product renamed or deleted next month must
                // not change what this order says was bought.
                productName: variant.product.name as Prisma.InputJsonValue,
                variantName: variant.name,
                sku: variant.sku,
                mediaKey: variant.product.media[0]?.media.storageKey ?? null,
                quantity: line.quantity,
                unitPrice: line.unitPriceMinor,
                unitCost: variant.costPrice,
                unitCompareAt: variant.compareAtPrice,
                discountAmount: discount,
                lineTotal: line.unitPriceMinor * BigInt(line.quantity) - discount,
              };
            }),
          },

          events: {
            create: {
              toStatus: status,
              kind: 'status',
              reason: autoConfirm ? 'Confirmée automatiquement' : 'Commande reçue',
            },
          },
        },
        select: { id: true, number: true, total: true, status: true },
      });

      // Stock: held now, or taken now when the shop auto-confirms and deducts on
      // confirmation. Either way it happens inside this transaction, so an order that
      // fails to write never leaves units held against nothing.
      for (const line of lines) {
        if (deductNow) {
          await this.ledger.postWithin(tx, {
            variantId: line.variantId,
            locationId,
            quantity: -line.quantity,
            reason: 'SALE',
            referenceType: 'order',
            referenceId: created.id,
            note: created.number,
            // Oversell is possible between the cart's check and this write; letting it
            // through and flagging the order beats refusing a paying customer.
            allowNegative: true,
          });
        } else {
          await this.ledger.reserveWithin(tx, line.variantId, locationId, line.quantity, {
            allowNegative: true,
          });
        }
      }

      await this.promotions.recordUsage(tx, promo, {
        id: created.id,
        customerId: customer?.id ?? null,
      });

      if (customer && totals.loyaltyPointsUsed > 0) {
        const balance = customer.loyaltyPoints - totals.loyaltyPointsUsed;
        await tx.customer.update({
          where: { id: customer.id },
          data: { loyaltyPoints: balance },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customerId: customer.id,
            orderId: created.id,
            points: -totals.loyaltyPointsUsed,
            kind: 'redeem',
            note: `Commande ${created.number}`,
            balanceAfter: balance,
          },
        });
      }

      // The cart is retired rather than deleted: it is the evidence behind the order,
      // and the abandoned-cart job must not pick it up again.
      await tx.cart.update({
        where: { id: cart.id },
        data: { convertedOrderId: created.id },
      });

      if (customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            ordersCount: { increment: 1 },
            lastOrderAt: new Date(),
            firstOrderAt: customer.firstOrderAt ?? new Date(),
            acceptsMarketing: input.acceptsMarketing || customer.acceptsMarketing,
          },
        });
      }

      return created;
    });

    this.announce(order, input, risk.score);

    return {
      orderId: order.id,
      number: order.number,
      totalMinor: order.total.toString(),
      status: order.status,
      paymentMethod: input.payment.method,
      checkoutUrl: null,
      trackingUrl: `${this.storefrontUrl()}/fr/track?number=${order.number}`,
      requiresReview: risk.score >= 50,
    };
  }

  // --- helpers --------------------------------------------------------------

  /** An order already written under this key; the retry returns it unchanged. */
  private async findReplay(key: string | null): Promise<CheckoutResult | null> {
    if (!key) return null;

    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, number: true, total: true, status: true, paymentMethod: true, riskScore: true },
    });
    if (!existing) return null;

    return {
      orderId: existing.id,
      number: existing.number,
      totalMinor: existing.total.toString(),
      status: existing.status,
      paymentMethod: existing.paymentMethod,
      checkoutUrl: null,
      trackingUrl: `${this.storefrontUrl()}/fr/track?number=${existing.number}`,
      requiresReview: existing.riskScore >= 50,
    };
  }

  /**
   * Finds the customer by phone, or creates one — PRD Section 3: the phone number is
   * the identity. A guest checkout still produces a customer record, which is what
   * makes the second order recognise them.
   */
  private async upsertCustomer(input: CheckoutInput, context: CheckoutContext) {
    if (context.customerId) {
      return this.prisma.customer.findUnique({ where: { id: context.customerId } });
    }

    const existing = await this.prisma.customer.findUnique({
      where: { phone: input.customer.phone },
    });
    if (existing) return existing;

    return this.prisma.customer.create({
      data: {
        phone: input.customer.phone,
        altPhone: input.customer.altPhone ?? null,
        fullName: input.customer.fullName,
        email: input.customer.email ?? null,
        acceptsMarketing: input.acceptsMarketing,
      },
    });
  }

  private async assess(
    input: CheckoutInput,
    context: CheckoutContext,
    customer: { id: string; blacklisted: boolean; deliveredCount: number; failedCount: number; cancelledCount: number } | null,
    orderTotalMinor: bigint,
  ) {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const duplicateWindow = await this.settings.get<number>(
      'orders.duplicate_window_minutes',
      30,
    );

    const [ordersToday, duplicate, fromIp, average] = await Promise.all([
      this.prisma.order.count({
        where: { customerPhone: input.customer.phone, createdAt: { gte: since } },
      }),
      duplicateWindow > 0
        ? this.prisma.order.count({
            where: {
              customerPhone: input.customer.phone,
              createdAt: { gte: new Date(Date.now() - duplicateWindow * 60_000) },
            },
          })
        : Promise.resolve(0),
      context.ip
        ? this.prisma.order.count({
            where: { ip: context.ip, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
          })
        : Promise.resolve(0),
      this.prisma.order.aggregate({
        where: { status: OrderStatus.DELIVERED },
        _avg: { total: true },
      }),
    ]);

    const policy: RiskPolicy = {
      maxOrdersPerPhonePerDay: await this.settings.get<number>('orders.max_per_phone_per_day', 3),
      maxOrdersPerIpPerHour: 8,
      reviewThreshold: 50,
    };

    return assessRisk(
      {
        deliveredCount: customer?.deliveredCount ?? 0,
        failedCount: customer?.failedCount ?? 0,
        cancelledCount: customer?.cancelledCount ?? 0,
        ordersToday,
        duplicateWithinWindow: duplicate > 0,
        blacklisted: customer?.blacklisted ?? false,
        ordersFromIpLastHour: fromIp,
        totalMinor: orderTotalMinor,
        averageOrderMinor: BigInt(Math.round(Number(average._avg.total ?? 0))),
        phoneUnverified: await this.settings.get<boolean>('orders.require_otp', false),
        addressSuspicious:
          input.shipping.deliveryType === DeliveryType.HOME && looksVague(input.shipping.address),
      },
      policy,
    );
  }

  private async loadVariants(variantIds: string[]) {
    const rows = await this.prisma.variant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        costPrice: true,
        compareAtPrice: true,
        weightGrams: true,
        product: {
          select: {
            name: true,
            media: {
              where: { position: 0 },
              take: 1,
              select: { media: { select: { storageKey: true } } },
            },
          },
        },
      },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Tells the admin and the notification queue. Deliberately outside the transaction
   * and deliberately unable to fail the request: an order that exists must not be
   * reported as failed because Redis is down.
   */
  private announce(
    order: { id: string; number: string; total: bigint; status: OrderStatus },
    input: CheckoutInput,
    riskScore: number,
  ): void {
    this.realtime.emit(
      'order.created',
      {
        orderId: order.id,
        number: order.number,
        totalMinor: order.total.toString(),
        customerName: input.customer.fullName,
        wilayaCode: input.shipping.wilayaCode,
        riskScore,
      },
      ['orders.read'],
    );

    void this.queue
      .enqueue('notifications', 'notification.dispatch', {
        event: 'order.placed',
        orderId: order.id,
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not queue the order notification: ${String(error)}`);
      });

    void this.queue
      .enqueue('notifications', 'notification.dispatch', {
        event: 'owner.new_order',
        orderId: order.id,
      })
      .catch(() => undefined);
  }

  private storefrontUrl(): string {
    return (this.config.get<string>('STOREFRONT_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }
}
