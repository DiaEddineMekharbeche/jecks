import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@jecks/db';
import {
  COURIER_CREDENTIAL_FIELDS,
  DELIVERY_ERRORS,
  type CourierDto,
  type CourierInput,
  type CourierProviderKey,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourierRegistry } from '../couriers/courier-registry.service.js';

/**
 * Couriers as the admin manages them — PRD F-AD-61 and Settings › Couriers.
 *
 * The list answers the two questions that matter operationally: can this courier
 * actually be used, and how much of our cash are they holding.
 */
@Injectable()
export class CouriersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierRegistry,
  ) {}

  async list(): Promise<CourierDto[]> {
    const couriers = await this.prisma.courier.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { shipments: true } } },
    });

    return Promise.all(couriers.map((courier) => this.toDto(courier, courier._count.shipments)));
  }

  async get(id: string): Promise<CourierDto> {
    const courier = await this.prisma.courier.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });
    if (!courier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });

    return this.toDto(courier, courier._count.shipments);
  }

  async create(input: CourierInput): Promise<CourierDto> {
    const existing = await this.prisma.courier.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new BadRequestException({
        code: 'SLUG_TAKEN',
        message: 'A courier already uses that slug',
        details: { field: 'slug' },
      });
    }

    const courier = await this.prisma.courier.create({
      data: {
        name: input.name,
        slug: input.slug,
        provider: input.provider,
        phone: input.phone ?? null,
        email: input.email ?? null,
        codFeePercent: input.codFeePercent,
        settlementDays: input.settlementDays,
        active: input.active,
      },
    });

    return this.toDto(courier, 0);
  }

  async update(id: string, input: CourierInput): Promise<CourierDto> {
    await this.get(id);

    const clash = await this.prisma.courier.findFirst({
      where: { slug: input.slug, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: 'SLUG_TAKEN',
        message: 'A courier already uses that slug',
        details: { field: 'slug' },
      });
    }

    const courier = await this.prisma.courier.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        provider: input.provider,
        phone: input.phone ?? null,
        email: input.email ?? null,
        codFeePercent: input.codFeePercent,
        settlementDays: input.settlementDays,
        active: input.active,
      },
      include: { _count: { select: { shipments: true } } },
    });

    return this.toDto(courier, courier._count.shipments);
  }

  /**
   * Deactivates rather than deletes once a courier has carried anything.
   *
   * Their shipments are the evidence behind every settlement and every delivery report;
   * removing the row would leave those numbers with nobody's name on them.
   */
  async remove(id: string): Promise<void> {
    const courier = await this.prisma.courier.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });
    if (!courier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });

    if (courier._count.shipments > 0) {
      await this.prisma.courier.update({ where: { id }, data: { active: false } });
      return;
    }

    await this.prisma.courier.delete({ where: { id } });
  }

  /** Stores credentials and reports what the adapter still needs. */
  async saveCredentials(id: string, values: Record<string, string>): Promise<CourierDto> {
    const courier = await this.prisma.courier.findUnique({ where: { id } });
    if (!courier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });

    await this.registry.saveCredentials(id, values);
    return this.get(id);
  }

  /**
   * Checks that the courier answers, without creating anything.
   *
   * "Save and hope" is how a shop finds out its API key is wrong at four in the
   * afternoon with thirty parcels waiting, so the settings screen can ask first.
   */
  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const courier = await this.prisma.courier.findUnique({ where: { id } });
    if (!courier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Courier not found' });

    const adapter = this.registry.adapterFor(courier.provider);
    if (adapter.requiredCredentials.length === 0) {
      return { ok: true, message: 'Ce transporteur ne demande aucune configuration.' };
    }

    let credentials;
    try {
      credentials = await this.registry.assertReady(id, courier.provider);
    } catch (error) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.COURIER_NOT_READY,
        message: (error as Error).message,
      });
    }

    try {
      // A tracking call with a number that cannot exist: it exercises authentication
      // without putting a parcel into their system.
      await adapter.track(['JECKS-CONNECTION-TEST'], credentials);
      return { ok: true, message: `${adapter.label} répond.` };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  private async toDto(
    courier: {
      id: string;
      name: string;
      slug: string;
      provider: string;
      phone: string | null;
      email: string | null;
      codFeePercent: unknown;
      settlementDays: number;
      active: boolean;
    },
    shipmentCount: number,
  ): Promise<CourierDto> {
    const adapter = this.registry.adapterFor(courier.provider);
    const { configuredKeys, ready } = await this.registry.describe(courier.id, courier.provider);

    // Cash they are holding: delivered parcels whose COD has not been settled.
    const open = await this.prisma.shipment.aggregate({
      where: { courierId: courier.id, status: ShipmentStatus.DELIVERED },
      _sum: { codAmount: true },
    });

    const settled = await this.prisma.courierSettlementLine.aggregate({
      where: { settlement: { courierId: courier.id, status: 'PAID' } },
      _sum: { codAmount: true },
    });

    const openCod = (open._sum.codAmount ?? 0n) - (settled._sum.codAmount ?? 0n);

    return {
      id: courier.id,
      name: courier.name,
      slug: courier.slug,
      provider: courier.provider as CourierProviderKey,
      phone: courier.phone,
      email: courier.email,
      codFeePercent: Number(courier.codFeePercent),
      settlementDays: courier.settlementDays,
      active: courier.active,
      configuredKeys,
      // A courier that needs nothing is ready the moment it exists.
      ready: adapter.requiredCredentials.length === 0 ? true : ready,
      supportsWebhook: adapter.supportsWebhook,
      supportsLabel: adapter.supportsLabel,
      shipmentCount,
      openCodMinor: (openCod > 0n ? openCod : 0n).toString(),
    };
  }

  /** The credential form Settings draws, per provider. */
  credentialFields() {
    return COURIER_CREDENTIAL_FIELDS;
  }
}
