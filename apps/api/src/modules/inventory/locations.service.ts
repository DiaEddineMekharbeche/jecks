import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  INVENTORY_ERRORS,
  t,
  type LocationDto,
  type LocationInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Stock locations — PRD F-AD-50. A handful of rows the whole admin reads as a list, so
 * there is no pagination here; what matters is that exactly one is the default and that
 * a location holding stock cannot be deleted out from under it.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<LocationDto[]> {
    const rows = await this.prisma.location.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        wilaya: { select: { name: true } },
        inventoryLevels: { select: { onHand: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address,
      wilayaCode: row.wilayaCode,
      wilayaName: row.wilaya ? t(row.wilaya.name as Translated, 'fr') : null,
      isDefault: row.isDefault,
      active: row.active,
      variantCount: row.inventoryLevels.length,
      onHand: row.inventoryLevels.reduce((sum, level) => sum + level.onHand, 0),
    }));
  }

  async get(id: string): Promise<LocationDto> {
    const all = await this.list();
    const found = all.find((location) => location.id === id);
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Location not found' });
    return found;
  }

  /** The location new stock lands in when a caller does not name one. */
  async defaultLocationId(): Promise<string> {
    const preferred = await this.prisma.location.findFirst({
      where: { active: true, isDefault: true },
      select: { id: true },
    });
    if (preferred) return preferred.id;

    const any = await this.prisma.location.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!any) {
      throw new ConflictException({
        code: 'NO_LOCATION',
        message: 'Create a stock location before moving inventory',
      });
    }
    return any.id;
  }

  async create(input: LocationInput): Promise<LocationDto> {
    await this.assertCodeFree(input.code);
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.location.updateMany({ data: { isDefault: false } });
      return tx.location.create({
        data: {
          name: input.name,
          code: input.code,
          address: input.address ?? null,
          wilayaCode: input.wilayaCode ?? null,
          isDefault: input.isDefault,
          active: input.active,
        },
        select: { id: true },
      });
    });
    return this.get(created.id);
  }

  async update(id: string, input: LocationInput): Promise<LocationDto> {
    await this.assertCodeFree(input.code, id);
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.location.updateMany({ data: { isDefault: false } });
      await tx.location.update({
        where: { id },
        data: {
          name: input.name,
          code: input.code,
          address: input.address ?? null,
          wilayaCode: input.wilayaCode ?? null,
          isDefault: input.isDefault,
          active: input.active,
        },
      });
    });
    return this.get(id);
  }

  /**
   * Refuses while stock, movements or purchase orders point at it. Deleting a location
   * that has a ledger would orphan the history that explains today's numbers.
   */
  async remove(id: string): Promise<void> {
    const [onHand, movements, purchaseOrders, remaining] = await Promise.all([
      this.prisma.inventoryLevel.aggregate({
        where: { locationId: id },
        _sum: { onHand: true, reserved: true },
      }),
      this.prisma.stockMovement.count({ where: { locationId: id } }),
      this.prisma.purchaseOrder.count({ where: { locationId: id, status: { not: 'CANCELLED' } } }),
      this.prisma.location.count({ where: { id: { not: id }, active: true } }),
    ]);

    const units = (onHand._sum.onHand ?? 0) + (onHand._sum.reserved ?? 0);
    if (units !== 0 || movements > 0 || purchaseOrders > 0) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.LOCATION_IN_USE,
        message:
          units !== 0
            ? `${units} unit(s) are still held here. Transfer them first.`
            : 'This location has stock history and cannot be deleted. Deactivate it instead.',
        details: { units, movements, purchaseOrders },
      });
    }

    if (remaining === 0) {
      throw new ConflictException({
        code: INVENTORY_ERRORS.LAST_LOCATION,
        message: 'At least one active location is required',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryLevel.deleteMany({ where: { locationId: id } });
      await tx.location.delete({ where: { id } });
      // Deleting the default leaves the shop without one, which every later write
      // would have to guess about; promote the oldest survivor instead.
      const stillDefault = await tx.location.count({ where: { isDefault: true } });
      if (stillDefault === 0) {
        const next = await tx.location.findFirst({
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) await tx.location.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async assertCodeFree(code: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.location.findFirst({
      where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'CODE_TAKEN',
        message: `Location code "${code}" is already used`,
        details: { field: 'code' },
      });
    }
  }
}
