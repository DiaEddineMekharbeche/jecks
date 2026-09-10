import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, UserType } from '@jecks/db';
import {
  DELIVERY_ERRORS,
  RoleSlug,
  type DriverDto,
  type DriverInput,
  type VehicleDto,
  type VehicleInput,
  type VehicleKind,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Vehicles and drivers — PRD F-AD-62/63.
 *
 * A driver is a `User` with the driver role plus a `Driver` row: one account, one
 * history, and the mobile view is the admin behind a permission rather than a second
 * application with its own login to forget.
 */
@Injectable()
export class FleetService {
  constructor(private readonly prisma: PrismaService) {}

  // --- vehicles -------------------------------------------------------------

  async listVehicles(): Promise<VehicleDto[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      orderBy: [{ active: 'desc' }, { label: 'asc' }],
      include: { _count: { select: { runs: true } } },
    });

    return vehicles.map((vehicle) => ({
      id: vehicle.id,
      plate: vehicle.plate,
      label: vehicle.label,
      kind: vehicle.kind as VehicleKind,
      capacityKg: vehicle.capacityKg,
      note: vehicle.note,
      active: vehicle.active,
      runCount: vehicle._count.runs,
    }));
  }

  async createVehicle(input: VehicleInput): Promise<VehicleDto> {
    const existing = await this.prisma.vehicle.findUnique({ where: { plate: input.plate } });
    if (existing) {
      throw new BadRequestException({
        code: 'PLATE_TAKEN',
        message: 'Ce véhicule existe déjà',
        details: { field: 'plate' },
      });
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        plate: input.plate,
        label: input.label,
        kind: input.kind,
        capacityKg: input.capacityKg,
        note: input.note ?? null,
        active: input.active,
      },
    });

    return { ...toVehicleDto(vehicle), runCount: 0 };
  }

  async updateVehicle(id: string, input: VehicleInput): Promise<VehicleDto> {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Vehicle not found' });

    const clash = await this.prisma.vehicle.findFirst({
      where: { plate: input.plate, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: 'PLATE_TAKEN',
        message: 'Ce véhicule existe déjà',
        details: { field: 'plate' },
      });
    }

    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: {
        plate: input.plate,
        label: input.label,
        kind: input.kind,
        capacityKg: input.capacityKg,
        note: input.note ?? null,
        active: input.active,
      },
      include: { _count: { select: { runs: true } } },
    });

    return { ...toVehicleDto(vehicle), runCount: vehicle._count.runs };
  }

  /** Retires a vehicle that has driven, deletes one that never did. */
  async removeVehicle(id: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { _count: { select: { runs: true } } },
    });
    if (!vehicle) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Vehicle not found' });

    if (vehicle._count.runs > 0) {
      await this.prisma.vehicle.update({ where: { id }, data: { active: false } });
      return;
    }
    await this.prisma.vehicle.delete({ where: { id } });
  }

  // --- drivers --------------------------------------------------------------

  async listDrivers(): Promise<DriverDto[]> {
    const drivers = await this.prisma.driver.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      include: {
        user: { select: { id: true, name: true, email: true } },
        wilaya: { select: { nameAscii: true } },
        _count: { select: { runs: true } },
      },
    });

    return Promise.all(drivers.map((driver) => this.toDriverDto(driver)));
  }

  async getDriver(id: string): Promise<DriverDto> {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        wilaya: { select: { nameAscii: true } },
        _count: { select: { runs: true } },
      },
    });
    if (!driver) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Driver not found' });
    return this.toDriverDto(driver);
  }

  /**
   * Creates a driver, and the account behind them when there is not one already.
   *
   * A new account gets no password: they sign in with the phone-and-code flow the
   * storefront already uses, which is the only thing that works on a delivery round.
   */
  async createDriver(input: DriverInput): Promise<DriverDto> {
    const driverRole = await this.prisma.role.findFirst({ where: { slug: RoleSlug.DRIVER } });

    const userId = await this.prisma.$transaction(async (tx) => {
      if (input.userId) {
        const existing = await tx.driver.findUnique({ where: { userId: input.userId } });
        if (existing) {
          throw new BadRequestException({
            code: 'ALREADY_A_DRIVER',
            message: 'Ce compte est déjà chauffeur',
          });
        }
        return input.userId;
      }

      if (!input.fullName) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Un nom est nécessaire pour créer le compte',
          details: { field: 'fullName' },
        });
      }

      const user = await tx.user.create({
        data: {
          type: UserType.STAFF,
          name: input.fullName,
          email: input.email ?? null,
          phone: input.phone,
          locale: 'fr',
          ...(driverRole ? { roles: { create: { roleId: driverRole.id } } } : {}),
        },
      });
      return user.id;
    });

    const driver = await this.prisma.driver.create({
      data: {
        userId,
        phone: input.phone,
        wilayaCode: input.wilayaCode ?? null,
        licenseNo: input.licenseNo ?? null,
        active: input.active,
      },
    });

    return this.getDriver(driver.id);
  }

  async updateDriver(id: string, input: DriverInput): Promise<DriverDto> {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Driver not found' });

    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id },
        data: {
          phone: input.phone,
          wilayaCode: input.wilayaCode ?? null,
          licenseNo: input.licenseNo ?? null,
          active: input.active,
        },
      });

      if (input.fullName || input.email !== undefined) {
        await tx.user.update({
          where: { id: driver.userId },
          data: {
            ...(input.fullName ? { name: input.fullName } : {}),
            ...(input.email === undefined ? {} : { email: input.email || null }),
            phone: input.phone,
          },
        });
      }
    });

    return this.getDriver(id);
  }

  /**
   * Deactivates a driver who still has an open run rather than removing them.
   *
   * Deleting somebody mid-round orphans the stops they are standing in front of.
   */
  async removeDriver(id: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: { _count: { select: { runs: true } } },
    });
    if (!driver) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Driver not found' });

    const openRun = await this.prisma.deliveryRun.findFirst({
      where: { driverId: id, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      select: { code: true },
    });
    if (openRun) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.DRIVER_BUSY,
        message: `Ce chauffeur a la tournée ${openRun.code} en cours.`,
      });
    }

    if (driver._count.runs > 0) {
      await this.prisma.driver.update({ where: { id }, data: { active: false } });
      return;
    }
    await this.prisma.driver.delete({ where: { id } });
  }

  /** The driver row behind a signed-in user, for the mobile view. */
  async driverForUser(userId: string): Promise<{ id: string } | null> {
    return this.prisma.driver.findUnique({ where: { userId }, select: { id: true } });
  }

  private async toDriverDto(driver: {
    id: string;
    userId: string;
    phone: string;
    wilayaCode: number | null;
    licenseNo: string | null;
    active: boolean;
    user: { id: string; name: string; email: string | null };
    wilaya: { nameAscii: string } | null;
    _count: { runs: number };
  }): Promise<DriverDto> {
    const [openRun, delivered, failed, cash] = await Promise.all([
      this.prisma.deliveryRun.findFirst({
        where: { driverId: driver.id, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
        orderBy: { date: 'desc' },
        select: { id: true },
      }),
      this.prisma.deliveryRunStop.count({ where: { run: { driverId: driver.id }, status: 'DELIVERED' } }),
      this.prisma.deliveryRunStop.count({ where: { run: { driverId: driver.id }, status: 'FAILED' } }),
      this.prisma.codCollection.aggregate({
        where: { driverId: driver.id, reconciledAt: null },
        _sum: { amount: true },
      }),
    ]);

    return {
      id: driver.id,
      userId: driver.userId,
      fullName: driver.user.name,
      email: driver.user.email ?? '',
      phone: driver.phone,
      wilayaCode: driver.wilayaCode,
      wilayaName: driver.wilaya?.nameAscii ?? null,
      licenseNo: driver.licenseNo,
      active: driver.active,
      openRunId: openRun?.id ?? null,
      runCount: driver._count.runs,
      deliveredCount: delivered,
      failedCount: failed,
      cashOnHandMinor: (cash._sum.amount ?? 0n).toString(),
    };
  }

  /** Orders that could be loaded onto a run: confirmed or packed, not already on one. */
  async assignableOrders(date: Date, wilayaCode?: number) {
    const assigned = await this.prisma.deliveryRunStop.findMany({
      where: { run: { status: { in: ['PLANNED', 'IN_PROGRESS'] } } },
      select: { orderId: true },
    });

    return this.prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PACKED] },
        id: { notIn: assigned.map((stop) => stop.orderId) },
        ...(wilayaCode ? { wilayaCode } : {}),
      },
      orderBy: [{ wilayaCode: 'asc' }, { createdAt: 'asc' }],
      take: 300,
      select: {
        id: true,
        number: true,
        customerName: true,
        customerPhone: true,
        address: true,
        communeName: true,
        wilayaCode: true,
        wilayaName: true,
        itemCount: true,
        total: true,
        paidTotal: true,
        createdAt: true,
      },
    });
  }
}

function toVehicleDto(vehicle: {
  id: string;
  plate: string;
  label: string;
  kind: string;
  capacityKg: number;
  note: string | null;
  active: boolean;
}): Omit<VehicleDto, 'runCount'> {
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    label: vehicle.label,
    kind: vehicle.kind as VehicleKind,
    capacityKg: vehicle.capacityKg,
    note: vehicle.note,
    active: vehicle.active,
  };
}
