import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryType, type Prisma } from '@jecks/db';
import {
  DELIVERY_ERRORS,
  type RateMatrixCell,
  type RateMatrixRow,
  type ShippingRateBulkInput,
  type ShippingRateDto,
  type ShippingRateInput,
  type ShippingZoneDto,
  type ShippingZoneInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { rateMargin, type RateCandidate } from './domain/rates.js';

/**
 * Shipping zones and rates — PRD F-AD-60.
 *
 * A zone groups wilayas that cost the same to reach; a rate prices one wilaya or one
 * zone for one delivery type. The matrix screen edits 116 cells at once, so the bulk
 * write is the main entry point and the single-row CRUD exists for the exceptions.
 */
@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  // --- zones ----------------------------------------------------------------

  async listZones(): Promise<ShippingZoneDto[]> {
    const zones = await this.prisma.shippingZone.findMany({
      orderBy: { position: 'asc' },
      include: { _count: { select: { rates: true } } },
    });

    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name as Translated,
      wilayaCodes: zone.wilayaCodes,
      position: zone.position,
      rateCount: zone._count.rates,
    }));
  }

  async createZone(input: ShippingZoneInput): Promise<ShippingZoneDto> {
    await this.assertWilayasFree(input.wilayaCodes, null);

    const zone = await this.prisma.shippingZone.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        wilayaCodes: input.wilayaCodes,
        position: input.position,
      },
      include: { _count: { select: { rates: true } } },
    });

    return {
      id: zone.id,
      name: zone.name as Translated,
      wilayaCodes: zone.wilayaCodes,
      position: zone.position,
      rateCount: zone._count.rates,
    };
  }

  async updateZone(id: string, input: ShippingZoneInput): Promise<ShippingZoneDto> {
    await this.getZone(id);
    await this.assertWilayasFree(input.wilayaCodes, id);

    const zone = await this.prisma.shippingZone.update({
      where: { id },
      data: {
        name: input.name as Prisma.InputJsonValue,
        wilayaCodes: input.wilayaCodes,
        position: input.position,
      },
      include: { _count: { select: { rates: true } } },
    });

    return {
      id: zone.id,
      name: zone.name as Translated,
      wilayaCodes: zone.wilayaCodes,
      position: zone.position,
      rateCount: zone._count.rates,
    };
  }

  /**
   * Deletes a zone, refusing while it still prices anything.
   *
   * Cascading would take the rates with it and leave those wilayas silently
   * undeliverable, which the shop would discover at checkout rather than here.
   */
  async removeZone(id: string): Promise<void> {
    const zone = await this.prisma.shippingZone.findUnique({
      where: { id },
      include: { _count: { select: { rates: true } } },
    });
    if (!zone) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Zone not found' });

    if (zone._count.rates > 0) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.ZONE_IN_USE,
        message: `This zone still prices ${zone._count.rates} rate(s). Move or delete them first.`,
      });
    }

    await this.prisma.shippingZone.delete({ where: { id } });
  }

  private async getZone(id: string) {
    const zone = await this.prisma.shippingZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Zone not found' });
    return zone;
  }

  /**
   * A wilaya belongs to one zone at most.
   *
   * Two zones claiming the same wilaya makes the quote depend on row order, which is a
   * bug that only shows up as an occasional wrong price.
   */
  private async assertWilayasFree(codes: number[], exceptZoneId: string | null): Promise<void> {
    const zones = await this.prisma.shippingZone.findMany({
      where: exceptZoneId ? { id: { not: exceptZoneId } } : {},
      select: { id: true, name: true, wilayaCodes: true },
    });

    const taken = new Map<number, Translated>();
    for (const zone of zones) {
      for (const code of zone.wilayaCodes) taken.set(code, zone.name as Translated);
    }

    const clash = codes.filter((code) => taken.has(code));
    if (clash.length > 0) {
      throw new BadRequestException({
        code: 'ZONE_OVERLAP',
        message: `Wilaya ${clash.join(', ')} already belongs to another zone`,
        details: { wilayaCodes: clash },
      });
    }
  }

  // --- rates ----------------------------------------------------------------

  async listRates(filters: { zoneId?: string; courierId?: string } = {}): Promise<ShippingRateDto[]> {
    const rates = await this.prisma.shippingRate.findMany({
      where: {
        ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
        ...(filters.courierId ? { courierId: filters.courierId } : {}),
      },
      orderBy: [{ wilayaCode: 'asc' }, { deliveryType: 'asc' }],
      include: {
        zone: { select: { name: true } },
        wilaya: { select: { nameAscii: true } },
        courier: { select: { name: true } },
      },
    });

    return rates.map((rate) => this.toDto(rate));
  }

  async createRate(input: ShippingRateInput): Promise<ShippingRateDto> {
    const rate = await this.prisma.shippingRate.create({
      data: this.toData(input),
      include: {
        zone: { select: { name: true } },
        wilaya: { select: { nameAscii: true } },
        courier: { select: { name: true } },
      },
    });
    return this.toDto(rate);
  }

  async updateRate(id: string, input: ShippingRateInput): Promise<ShippingRateDto> {
    const existing = await this.prisma.shippingRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rate not found' });

    const rate = await this.prisma.shippingRate.update({
      where: { id },
      data: this.toData(input),
      include: {
        zone: { select: { name: true } },
        wilaya: { select: { nameAscii: true } },
        courier: { select: { name: true } },
      },
    });
    return this.toDto(rate);
  }

  /**
   * Removes a rate, unless it is the last thing serving that wilaya and type.
   *
   * The check is deliberate rather than a cascade: leaving a wilaya with no rate makes
   * checkout refuse orders from it, and that is a decision to take on purpose.
   */
  async removeRate(id: string): Promise<void> {
    const rate = await this.prisma.shippingRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rate not found' });

    if (rate.wilayaCode !== null) {
      const zone = await this.prisma.shippingZone.findFirst({
        where: { wilayaCodes: { has: rate.wilayaCode } },
        select: { id: true },
      });

      const alternatives = await this.prisma.shippingRate.count({
        where: {
          id: { not: id },
          active: true,
          deliveryType: rate.deliveryType,
          OR: [{ wilayaCode: rate.wilayaCode }, ...(zone ? [{ zoneId: zone.id }] : [])],
        },
      });

      if (alternatives === 0) {
        throw new BadRequestException({
          code: DELIVERY_ERRORS.RATE_IN_USE,
          message:
            'This is the only rate covering that wilaya and delivery type. Add another before removing it.',
        });
      }
    }

    await this.prisma.shippingRate.delete({ where: { id } });
  }

  /**
   * The matrix: every wilaya with its home and stop-desk price.
   *
   * A cell with no rate of its own shows the zone's, marked as inherited, so an operator
   * can see at a glance where a price is a deliberate exception and where it is a
   * default they have never looked at.
   */
  async matrix(courierId?: string): Promise<RateMatrixRow[]> {
    const [wilayas, zones, rates] = await Promise.all([
      this.prisma.wilaya.findMany({ orderBy: { code: 'asc' }, select: { code: true, nameAscii: true } }),
      this.prisma.shippingZone.findMany({ select: { id: true, name: true, wilayaCodes: true } }),
      this.prisma.shippingRate.findMany({
        where: courierId ? { OR: [{ courierId }, { courierId: null }] } : {},
        select: {
          id: true,
          wilayaCode: true,
          zoneId: true,
          courierId: true,
          deliveryType: true,
          price: true,
          cost: true,
          active: true,
        },
      }),
    ]);

    const zoneOf = new Map<number, { id: string; name: Translated }>();
    for (const zone of zones) {
      for (const code of zone.wilayaCodes) {
        zoneOf.set(code, { id: zone.id, name: zone.name as Translated });
      }
    }

    const pick = (wilayaCode: number, type: DeliveryType): RateMatrixCell | null => {
      const specific = rates.find(
        (rate) => rate.wilayaCode === wilayaCode && rate.deliveryType === type,
      );
      if (specific) return cellOf(specific, false);

      const zone = zoneOf.get(wilayaCode);
      const inherited = zone
        ? rates.find((rate) => rate.zoneId === zone.id && rate.deliveryType === type)
        : undefined;

      return inherited ? cellOf(inherited, true) : null;
    };

    return wilayas.map((wilaya) => ({
      wilayaCode: wilaya.code,
      wilayaName: wilaya.nameAscii,
      zoneName: zoneOf.get(wilaya.code)?.name ?? null,
      home: pick(wilaya.code, DeliveryType.HOME),
      stopDesk: pick(wilaya.code, DeliveryType.STOP_DESK),
    }));
  }

  /**
   * Writes many cells at once, in one transaction.
   *
   * Half-applied pricing is worse than none: a shop that changes 58 wilayas and has 30
   * of them land is charging two different prices for the same journey until somebody
   * notices.
   */
  async bulkUpsert(input: ShippingRateBulkInput): Promise<{ written: number }> {
    const written = await this.prisma.$transaction(async (tx) => {
      let count = 0;

      for (const cell of input.cells) {
        const existing = await tx.shippingRate.findFirst({
          where: {
            wilayaCode: cell.wilayaCode,
            deliveryType: cell.deliveryType,
            courierId: cell.courierId ?? null,
          },
          select: { id: true },
        });

        if (existing) {
          await tx.shippingRate.update({
            where: { id: existing.id },
            data: {
              price: cell.price,
              ...(cell.cost === undefined ? {} : { cost: cell.cost }),
              ...(cell.active === undefined ? {} : { active: cell.active }),
            },
          });
        } else {
          await tx.shippingRate.create({
            data: {
              wilayaCode: cell.wilayaCode,
              deliveryType: cell.deliveryType,
              courierId: cell.courierId ?? null,
              price: cell.price,
              cost: cell.cost ?? 0n,
              active: cell.active ?? true,
            },
          });
        }
        count += 1;
      }

      return count;
    });

    return { written };
  }

  private toData(input: ShippingRateInput): Prisma.ShippingRateUncheckedCreateInput {
    return {
      zoneId: input.zoneId ?? null,
      wilayaCode: input.wilayaCode ?? null,
      courierId: input.courierId ?? null,
      deliveryType: input.deliveryType,
      price: input.price,
      cost: input.cost,
      freeWeightGrams: input.freeWeightGrams,
      extraPerKg: input.extraPerKg,
      freeShippingThreshold: input.freeShippingThreshold ?? null,
      etaMinDays: input.etaMinDays,
      etaMaxDays: input.etaMaxDays,
      active: input.active,
    };
  }

  private toDto(rate: {
    id: string;
    zoneId: string | null;
    wilayaCode: number | null;
    courierId: string | null;
    deliveryType: DeliveryType;
    price: bigint;
    cost: bigint;
    freeWeightGrams: number;
    extraPerKg: bigint;
    freeShippingThreshold: bigint | null;
    etaMinDays: number;
    etaMaxDays: number;
    active: boolean;
    zone?: { name: unknown } | null;
    wilaya?: { nameAscii: string } | null;
    courier?: { name: string } | null;
  }): ShippingRateDto {
    return {
      id: rate.id,
      zoneId: rate.zoneId,
      zoneName: (rate.zone?.name as Translated | undefined) ?? null,
      wilayaCode: rate.wilayaCode,
      wilayaName: rate.wilaya?.nameAscii ?? null,
      courierId: rate.courierId,
      courierName: rate.courier?.name ?? null,
      deliveryType: rate.deliveryType,
      priceMinor: rate.price.toString(),
      costMinor: rate.cost.toString(),
      marginMinor: rateMargin({ priceMinor: rate.price, costMinor: rate.cost }).toString(),
      freeWeightGrams: rate.freeWeightGrams,
      extraPerKgMinor: rate.extraPerKg.toString(),
      freeShippingThresholdMinor: rate.freeShippingThreshold?.toString() ?? null,
      etaMinDays: rate.etaMinDays,
      etaMaxDays: rate.etaMaxDays,
      active: rate.active,
    };
  }
}

function cellOf(
  rate: { id: string; courierId: string | null; price: bigint; cost: bigint; active: boolean },
  inherited: boolean,
): RateMatrixCell {
  return {
    id: rate.id,
    courierId: rate.courierId,
    priceMinor: rate.price.toString(),
    costMinor: rate.cost.toString(),
    active: rate.active,
    inherited,
  };
}

/** Shape the quote needs, built from a row plus its courier. */
export function toRateCandidate(rate: {
  id: string;
  wilayaCode: number | null;
  zoneId: string | null;
  courierId: string | null;
  price: bigint;
  cost: bigint;
  freeWeightGrams: number;
  extraPerKg: bigint;
  freeShippingThreshold: bigint | null;
  etaMinDays: number;
  etaMaxDays: number;
  active: boolean;
  courier?: { active: boolean } | null;
}): RateCandidate {
  return {
    id: rate.id,
    wilayaCode: rate.wilayaCode,
    zoneId: rate.zoneId,
    courierId: rate.courierId,
    courierActive: rate.courier?.active ?? true,
    priceMinor: rate.price,
    costMinor: rate.cost,
    freeWeightGrams: rate.freeWeightGrams,
    extraPerKgMinor: rate.extraPerKg,
    freeShippingThresholdMinor: rate.freeShippingThreshold,
    etaMinDays: rate.etaMinDays,
    etaMaxDays: rate.etaMaxDays,
    active: rate.active,
  };
}
