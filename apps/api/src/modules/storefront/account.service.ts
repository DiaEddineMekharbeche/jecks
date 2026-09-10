import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  STOREFRONT_ERRORS,
  t,
  type AccountProfile,
  type AddressDto,
  type AddressInput,
  type LoyaltyEntry,
  type TrackedOrder,
  type TrackOrderInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * The shopper's own account and the public tracking page — PRD F-ST-51, F-ST-52.
 *
 * Nothing here trusts an id from the browser. An order is reachable either by being
 * the signed-in customer's, or by quoting its number *and* the phone it was placed
 * with; a bare order number is not a key.
 */

const ORDER_INCLUDE = {
  wilaya: { select: { name: true } },
  commune: { select: { name: true } },
  items: {
    select: {
      productName: true,
      variantName: true,
      quantity: true,
      unitPrice: true,
      mediaKey: true,
    },
  },
  events: {
    orderBy: { createdAt: 'asc' as const },
    select: { toStatus: true, createdAt: true, reason: true },
  },
  shipments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      trackingNumber: true,
      courier: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // --- profile --------------------------------------------------------------

  async profile(customerId: string): Promise<AccountProfile> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException({
        code: STOREFRONT_ERRORS.NOT_A_CUSTOMER,
        message: 'No account found',
      });
    }

    const pointValue = BigInt(
      await this.settings.get<number>('loyalty.point_value_centimes', 0),
    );

    return {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email,
      locale: customer.locale,
      loyaltyPoints: customer.loyaltyPoints,
      loyaltyValueMinor: (BigInt(customer.loyaltyPoints) * pointValue).toString(),
      ordersCount: customer.ordersCount,
      deliveredCount: customer.deliveredCount,
      lifetimeValueMinor: customer.lifetimeValue.toString(),
      acceptsMarketing: customer.acceptsMarketing,
      memberSince: customer.createdAt.toISOString(),
    };
  }

  async updateProfile(
    customerId: string,
    input: { fullName?: string; email?: string; locale?: string; acceptsMarketing?: boolean },
  ): Promise<AccountProfile> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        fullName: input.fullName,
        email: input.email,
        locale: input.locale,
        acceptsMarketing: input.acceptsMarketing,
      },
    });
    return this.profile(customerId);
  }

  /**
   * Account deletion — PRD Section 10.8.
   *
   * A soft delete that scrubs the contact details rather than a hard one: the orders
   * this person placed are accounting records the shop is required to keep, and a
   * cascade would take the shop's own books with them. The phone is rewritten so the
   * unique index frees up and the same number can shop again as a new customer.
   */
  async deleteAccount(customerId: string): Promise<{ deleted: true }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, phone: true, userId: true },
    });
    if (!customer) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No account found' });
    }

    const stamp = Date.now().toString(36);
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          deletedAt: new Date(),
          phone: `deleted-${stamp}-${customer.phone}`.slice(0, 20),
          email: null,
          fullName: 'Compte supprimé',
          altPhone: null,
          acceptsMarketing: false,
        },
      });
      await tx.customerAddress.deleteMany({ where: { customerId } });
      await tx.wishlistItem.deleteMany({ where: { customerId } });
      if (customer.userId) {
        await tx.session.updateMany({
          where: { userId: customer.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.user.update({
          where: { id: customer.userId },
          data: { active: false, deletedAt: new Date(), phone: null, email: null },
        });
      }
    });

    return { deleted: true };
  }

  // --- addresses ------------------------------------------------------------

  async listAddresses(customerId: string): Promise<AddressDto[]> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: {
        wilaya: { select: { name: true } },
        commune: { select: { name: true } },
      },
    });
    return rows.map(toAddress);
  }

  async createAddress(customerId: string, input: AddressInput): Promise<AddressDto[]> {
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      const count = await tx.customerAddress.count({ where: { customerId } });
      await tx.customerAddress.create({
        data: {
          customerId,
          label: input.label ?? null,
          fullName: input.fullName,
          phone: input.phone,
          altPhone: input.altPhone ?? null,
          wilayaCode: input.wilayaCode,
          communeId: input.communeId,
          address: input.address,
          // The first address a shopper saves is their default whether they ticked the
          // box or not; an account with no default makes checkout ask a needless question.
          isDefault: input.isDefault || count === 0,
        },
      });
    });
    return this.listAddresses(customerId);
  }

  async updateAddress(
    customerId: string,
    id: string,
    input: AddressInput,
  ): Promise<AddressDto[]> {
    const owned = await this.prisma.customerAddress.count({ where: { id, customerId } });
    if (!owned) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'That address is not yours' });
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      await tx.customerAddress.update({
        where: { id },
        data: {
          label: input.label ?? null,
          fullName: input.fullName,
          phone: input.phone,
          altPhone: input.altPhone ?? null,
          wilayaCode: input.wilayaCode,
          communeId: input.communeId,
          address: input.address,
          isDefault: input.isDefault,
        },
      });
    });
    return this.listAddresses(customerId);
  }

  async deleteAddress(customerId: string, id: string): Promise<AddressDto[]> {
    await this.prisma.customerAddress.deleteMany({ where: { id, customerId } });

    // Deleting the default leaves checkout with nothing preselected; promote the newest.
    const remaining = await this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, isDefault: true },
    });
    if (remaining.length > 0 && !remaining.some((address) => address.isDefault)) {
      await this.prisma.customerAddress.update({
        where: { id: remaining[0]!.id },
        data: { isDefault: true },
      });
    }

    return this.listAddresses(customerId);
  }

  // --- orders ---------------------------------------------------------------

  async listOrders(customerId: string, page = 1, pageSize = 10) {
    const size = Math.min(Math.max(pageSize, 1), 50);
    const where: Prisma.OrderWhereInput = { customerId, deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(page, 1) - 1) * size,
        take: size,
        include: ORDER_INCLUDE,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toTracked(row)),
      meta: { page: Math.max(page, 1), pageSize: size, total },
    };
  }

  async getOrder(customerId: string, number: string): Promise<TrackedOrder> {
    const order = await this.prisma.order.findFirst({
      where: { number, customerId, deletedAt: null },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException({
        code: STOREFRONT_ERRORS.ORDER_NOT_FOUND,
        message: 'No order with that number',
      });
    }
    return this.toTracked(order);
  }

  /**
   * Public tracking — PRD F-ST-52. Number plus phone, both required.
   *
   * The phone is what makes an order number safe to guess: numbers are sequential by
   * design so they can be read out on the telephone, and a number alone would let
   * anyone walk the shop's whole order history.
   */
  async track(input: TrackOrderInput): Promise<TrackedOrder> {
    const order = await this.prisma.order.findFirst({
      where: {
        number: input.number,
        deletedAt: null,
        OR: [{ customerPhone: input.phone }, { customerAltPhone: input.phone }],
      },
      include: ORDER_INCLUDE,
    });

    if (!order) {
      // Deliberately the same message whether the number is wrong or the phone is:
      // distinguishing them turns this endpoint into a phone-number oracle.
      throw new NotFoundException({
        code: STOREFRONT_ERRORS.ORDER_NOT_FOUND,
        message: 'No order matches that number and phone number',
      });
    }

    return this.toTracked(order);
  }

  // --- loyalty --------------------------------------------------------------

  async loyaltyLedger(customerId: string, limit = 50): Promise<LoyaltyEntry[]> {
    const rows = await this.prisma.loyaltyTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { order: { select: { number: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      points: row.points,
      kind: row.kind,
      note: row.note,
      balanceAfter: row.balanceAfter,
      orderNumber: row.order?.number ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // --- shaping --------------------------------------------------------------

  private toTracked(order: OrderRecord): TrackedOrder {
    const shipment = order.shipments[0];

    return {
      number: order.number,
      status: order.status,
      placedAt: order.createdAt.toISOString(),
      itemCount: order.itemCount,
      totalMinor: order.total.toString(),
      currency: order.currency,
      wilayaName: t(order.wilaya.name as Translated, 'fr'),
      communeName: order.commune ? t(order.commune.name as Translated, 'fr') : order.communeName,
      deliveryType: order.deliveryType,
      courierName: shipment?.courier?.name ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      estimatedDelivery: null,
      timeline: order.events
        .filter((event) => event.toStatus !== null)
        .map((event) => ({
          status: event.toStatus!,
          at: event.createdAt.toISOString(),
          note: event.reason,
        })),
      items: order.items.map((item) => ({
        productName: item.productName as Translated,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPriceMinor: item.unitPrice.toString(),
        imageUrl: this.storage.publicUrl(item.mediaKey),
      })),
    };
  }
}

type AddressRecord = Prisma.CustomerAddressGetPayload<{
  include: { wilaya: { select: { name: true } }; commune: { select: { name: true } } };
}>;

function toAddress(row: AddressRecord): AddressDto {
  return {
    id: row.id,
    label: row.label,
    fullName: row.fullName,
    phone: row.phone,
    altPhone: row.altPhone,
    wilayaCode: row.wilayaCode,
    wilayaName: t(row.wilaya.name as Translated, 'fr'),
    communeId: row.communeId,
    communeName: row.commune ? t(row.commune.name as Translated, 'fr') : null,
    address: row.address ?? '',
    isDefault: row.isDefault,
  };
}
