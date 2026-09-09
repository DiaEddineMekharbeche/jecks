import { BadRequestException, Injectable } from '@nestjs/common';
import type { DeliveryType } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';

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
   * Cheapest active rate for a wilaya and delivery type — PRD F-AD-60.
   *
   * A wilaya-specific rate always wins over a zone rate. Weight beyond the allowance
   * is billed per started kilo, and the free-shipping threshold is applied last so a
   * heavy-parcel surcharge cannot survive a qualifying subtotal.
   */
  async quote(input: {
    wilayaCode: number;
    deliveryType: DeliveryType;
    weightGrams?: number;
    subtotal?: bigint;
  }): Promise<ShippingQuote> {
    const { wilayaCode, deliveryType, weightGrams = 0, subtotal = 0n } = input;

    const rates = await this.prisma.shippingRate.findMany({
      where: { wilayaCode, deliveryType, active: true },
      include: { courier: { select: { id: true, name: true, active: true } } },
      orderBy: { price: 'asc' },
    });

    const usable = rates.filter((rate) => !rate.courier || rate.courier.active);
    const rate = usable[0];
    if (!rate) {
      throw new BadRequestException({
        code: 'NO_SHIPPING_RATE',
        message: 'We do not deliver to that wilaya yet',
      });
    }

    const overweightGrams = Math.max(weightGrams - rate.freeWeightGrams, 0);
    const extraKilos = Math.ceil(overweightGrams / 1000);
    let price = rate.price + rate.extraPerKg * BigInt(extraKilos);

    const threshold = rate.freeShippingThreshold;
    const freeShippingApplied = threshold != null && subtotal >= threshold;
    if (freeShippingApplied) price = 0n;

    return {
      wilayaCode,
      deliveryType,
      courierId: rate.courier?.id ?? null,
      courierName: rate.courier?.name ?? null,
      price,
      cost: rate.cost,
      freeShippingApplied,
      etaMinDays: rate.etaMinDays,
      etaMaxDays: rate.etaMaxDays,
    };
  }
}
