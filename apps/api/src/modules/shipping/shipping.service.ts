import { BadRequestException, Injectable } from '@nestjs/common';
import type { DeliveryType } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { applyRate, selectRate } from '../delivery/domain/rates.js';
import { toRateCandidate } from '../delivery/zones.service.js';

export interface ShippingQuote {
  wilayaCode: number;
  deliveryType: DeliveryType;
  courierId: string | null;
  courierName: string | null;
  /** What the shopper pays, in centimes. */
  price: bigint;
  /** What we pay the courier — never sent to the storefront. */
  cost: bigint;
  freeShippingApplied: boolean;
  etaMinDays: number;
  etaMaxDays: number;
}

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async listWilayas() {
    return this.prisma.wilaya.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, nameAscii: true },
    });
  }

  async listCommunes(wilayaCode: number) {
    return this.prisma.commune.findMany({
      where: { wilayaCode, active: true },
      orderBy: { nameAscii: 'asc' },
      select: { id: true, name: true, nameAscii: true, postalCode: true },
    });
  }

  async listPickupPoints(wilayaCode: number) {
    return this.prisma.pickupPoint.findMany({
      where: { wilayaCode, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        openingHours: true,
        courier: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * The rate that applies to a wilaya and delivery type — PRD F-AD-60.
   *
   * A wilaya-specific rate wins over the zone that contains it, weight over the
   * allowance is billed per started kilo, and the free-shipping threshold is applied
   * last. The choosing and the arithmetic are pure and live in `domain/rates`; this
   * method's only job is finding the candidate rows, including the ones that reach the
   * wilaya through its zone.
   */
  async quote(input: {
    wilayaCode: number;
    deliveryType: DeliveryType;
    weightGrams?: number;
    subtotal?: bigint;
  }): Promise<ShippingQuote> {
    const { wilayaCode, deliveryType, weightGrams = 0, subtotal = 0n } = input;

    const zone = await this.prisma.shippingZone.findFirst({
      where: { wilayaCodes: { has: wilayaCode } },
      select: { id: true },
    });

    const rows = await this.prisma.shippingRate.findMany({
      where: {
        deliveryType,
        OR: [{ wilayaCode }, ...(zone ? [{ zoneId: zone.id }] : [])],
      },
      include: { courier: { select: { id: true, name: true, active: true } } },
    });

    const chosen = selectRate(rows.map(toRateCandidate));
    if (!chosen) {
      throw new BadRequestException({
        code: 'NO_SHIPPING_RATE',
        message: 'We do not deliver to that wilaya yet',
      });
    }

    const applied = applyRate(chosen, { weightGrams, subtotalMinor: subtotal });
    const row = rows.find((rate) => rate.id === chosen.id)!;

    return {
      wilayaCode,
      deliveryType,
      courierId: row.courier?.id ?? null,
      courierName: row.courier?.name ?? null,
      price: applied.priceMinor,
      cost: applied.costMinor,
      freeShippingApplied: applied.freeShippingApplied,
      etaMinDays: chosen.etaMinDays,
      etaMaxDays: chosen.etaMaxDays,
    };
  }
}
