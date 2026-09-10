import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, type DeliveryRunStatus, type Prisma } from '@jecks/db';
import {
  DELIVERY_ERRORS,
  type DeliveryRunDto,
  type DeliveryRunInput,
  type DeliveryRunStatusValue,
  type DeliveryRunStopDto,
  type RunAssignInput,
  type RunReorderInput,
  type StopStatus,
  type StopUpdateInput,
} from '@jecks/shared';
import { renderManifest } from '../../common/pdf/delivery-documents.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { OrderTransitionService } from '../orders/order-transition.service.js';
import { isLocated, optimiseRoute, routeLengthKm, type RoutableStop } from './domain/routing.js';

/**
 * Delivery runs — PRD F-AD-62/63.
 *
 * A run is one driver's day: a list of stops in the order they will be driven, the cash
 * they are expected to bring back, and what actually happened at each door.
 *
 * Closing a stop is the moment that matters. It moves the order through the state
 * machine, records the cash, and cannot be done twice.
 */

/** Stops that are finished. Reopening one would double-count its cash. */
const CLOSED: StopStatus[] = ['DELIVERED', 'FAILED', 'RESCHEDULED'];

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: OrderTransitionService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // --- runs -----------------------------------------------------------------

  async list(filters: { date?: Date; driverId?: string; status?: string[] } = {}) {
    const runs = await this.prisma.deliveryRun.findMany({
      where: {
        ...(filters.date ? { date: startOfDay(filters.date) } : {}),
        ...(filters.driverId ? { driverId: filters.driverId } : {}),
        ...(filters.status?.length ? { status: { in: filters.status as DeliveryRunStatus[] } } : {}),
      },
      orderBy: [{ date: 'desc' }, { code: 'desc' }],
      take: 200,
      include: this.runInclude(),
    });

    return Promise.all(runs.map((run) => this.toDto(run, false)));
  }

  async get(id: string, forDriverId?: string): Promise<DeliveryRunDto> {
    const run = await this.prisma.deliveryRun.findUnique({
      where: { id },
      include: this.runInclude(),
    });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });

    // A driver sees their own run and nobody else's — PRD acceptance criterion 6.
    if (forDriverId && run.driverId !== forDriverId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This run belongs to another driver' });
    }

    return this.toDto(run, true);
  }

  /** The run a driver should be looking at right now. */
  async todayFor(driverId: string): Promise<DeliveryRunDto | null> {
    const run = await this.prisma.deliveryRun.findFirst({
      where: { driverId, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      orderBy: { date: 'asc' },
      include: this.runInclude(),
    });

    return run ? this.toDto(run, true) : null;
  }

  async create(input: DeliveryRunInput): Promise<DeliveryRunDto> {
    const driver = await this.prisma.driver.findUnique({ where: { id: input.driverId } });
    if (!driver) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Driver not found' });

    const date = startOfDay(input.date);
    const code = await this.nextCode(date);

    const run = await this.prisma.deliveryRun.create({
      data: {
        code,
        date,
        driverId: input.driverId,
        vehicleId: input.vehicleId ?? null,
        note: input.note ?? null,
      },
      include: this.runInclude(),
    });

    return this.toDto(run, true);
  }

  async update(id: string, input: DeliveryRunInput): Promise<DeliveryRunDto> {
    const run = await this.requireEditable(id);

    await this.prisma.deliveryRun.update({
      where: { id: run.id },
      data: {
        date: startOfDay(input.date),
        driverId: input.driverId,
        vehicleId: input.vehicleId ?? null,
        note: input.note ?? null,
      },
    });

    return this.get(id);
  }

  /**
   * Adds orders to a run, at the end of the current route.
   *
   * The expected cash is recomputed from the orders rather than added up incrementally,
   * so a run that has been edited five times still totals correctly.
   */
  async assign(id: string, input: RunAssignInput): Promise<DeliveryRunDto> {
    await this.requireEditable(id);

    const orders = await this.prisma.order.findMany({
      where: { id: { in: input.orderIds }, deletedAt: null },
      select: { id: true, number: true, status: true },
    });

    const taken = await this.prisma.deliveryRunStop.findMany({
      where: {
        orderId: { in: input.orderIds },
        runId: { not: id },
        run: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      },
      select: { orderId: true, run: { select: { code: true } } },
    });

    if (taken.length > 0) {
      throw new BadRequestException({
        code: 'ORDER_ON_ANOTHER_RUN',
        message: `Déjà sur la tournée ${taken[0]!.run.code}`,
        details: { orderIds: taken.map((stop) => stop.orderId) },
      });
    }

    const last = await this.prisma.deliveryRunStop.aggregate({
      where: { runId: id },
      _max: { position: true },
    });
    let position = (last._max.position ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      for (const order of orders) {
        await tx.deliveryRunStop.upsert({
          where: { runId_orderId: { runId: id, orderId: order.id } },
          create: { runId: id, orderId: order.id, position },
          update: {},
        });
        position += 1;
      }
    });

    await this.refreshExpectedCash(id);
    return this.get(id);
  }

  async unassign(id: string, stopId: string): Promise<DeliveryRunDto> {
    await this.requireEditable(id);

    const stop = await this.prisma.deliveryRunStop.findFirst({ where: { id: stopId, runId: id } });
    if (!stop) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stop not found' });

    if (CLOSED.includes(stop.status as StopStatus)) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.STOP_ALREADY_CLOSED,
        message: 'Cet arrêt est déjà clôturé : il reste dans l’historique de la tournée.',
      });
    }

    await this.prisma.deliveryRunStop.delete({ where: { id: stopId } });
    await this.resequence(id);
    await this.refreshExpectedCash(id);
    return this.get(id);
  }

  /** Applies a hand-dragged order. */
  async reorder(id: string, input: RunReorderInput): Promise<DeliveryRunDto> {
    await this.requireEditable(id);

    await this.prisma.$transaction(
      input.stopIds.map((stopId, index) =>
        this.prisma.deliveryRunStop.updateMany({
          where: { id: stopId, runId: id },
          data: { position: index + 1 },
        }),
      ),
    );

    return this.get(id);
  }

  /**
   * Orders the stops by distance from the warehouse — PRD F-AD-62.
   *
   * Stops that are already closed keep their place at the front: reordering somewhere a
   * driver has already been would renumber a manifest they are holding.
   */
  async optimise(id: string): Promise<DeliveryRunDto> {
    await this.requireEditable(id);

    const stops = await this.prisma.deliveryRunStop.findMany({
      where: { runId: id },
      orderBy: { position: 'asc' },
      include: {
        order: {
          select: {
            communeId: true,
            wilayaCode: true,
            commune: { select: { latitude: true, longitude: true } },
            wilaya: { select: { latitude: true, longitude: true } },
          },
        },
      },
    });

    const closed = stops.filter((stop) => CLOSED.includes(stop.status as StopStatus));
    const open = stops.filter((stop) => !CLOSED.includes(stop.status as StopStatus));

    const depot = await this.depot();
    const routable: RoutableStop[] = open.map((stop) => {
      const point = coordinatesOf(stop.order);
      return { id: stop.id, latitude: point?.latitude ?? Number.NaN, longitude: point?.longitude ?? Number.NaN };
    });

    const ordered = optimiseRoute(depot, routable);
    const sequence = [...closed.map((stop) => stop.id), ...ordered.map((stop) => stop.id)];

    await this.prisma.$transaction(
      sequence.map((stopId, index) =>
        this.prisma.deliveryRunStop.update({ where: { id: stopId }, data: { position: index + 1 } }),
      ),
    );

    return this.get(id);
  }

  async start(id: string): Promise<DeliveryRunDto> {
    const run = await this.prisma.deliveryRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });

    if (run.status !== 'PLANNED') {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.RUN_NOT_EDITABLE,
        message: 'Cette tournée est déjà partie.',
      });
    }

    await this.prisma.deliveryRun.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    return this.get(id);
  }

  /**
   * Closes a run.
   *
   * Open stops are left as they are and reported, rather than being marked failed: a
   * driver who ran out of daylight has not failed those deliveries, and inventing a
   * failure would corrupt the delivery-success rate the shop steers by.
   */
  async complete(id: string): Promise<DeliveryRunDto> {
    const run = await this.prisma.deliveryRun.findUnique({
      where: { id },
      include: { stops: { select: { status: true } } },
    });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });

    const collected = await this.prisma.deliveryRunStop.aggregate({
      where: { runId: id },
      _sum: { cashCollected: true },
    });

    await this.prisma.deliveryRun.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        collectedCash: collected._sum.cashCollected ?? 0n,
      },
    });

    return this.get(id);
  }

  async cancel(id: string): Promise<DeliveryRunDto> {
    const run = await this.requireEditable(id);
    await this.prisma.deliveryRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } });
    return this.get(id);
  }

  // --- stops ----------------------------------------------------------------

  /**
   * What happened at a door — PRD F-AD-63.
   *
   * One call does everything that follows from an outcome: the stop, the order
   * transition, and the cash. A stop that is already closed is refused rather than
   * reapplied, because the second application would record the money twice.
   */
  async updateStop(
    runId: string,
    stopId: string,
    input: StopUpdateInput,
    actor: { id: string | null; name: string },
    forDriverId?: string,
  ): Promise<DeliveryRunDto> {
    const stop = await this.prisma.deliveryRunStop.findFirst({
      where: { id: stopId, runId },
      include: {
        run: { select: { id: true, driverId: true, status: true } },
        order: { select: { id: true, number: true, status: true, total: true, paidTotal: true } },
      },
    });
    if (!stop) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stop not found' });

    if (forDriverId && stop.run.driverId !== forDriverId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This run belongs to another driver' });
    }

    if (stop.run.status === 'CANCELLED') {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.RUN_CLOSED,
        message: 'Cette tournée est annulée.',
      });
    }

    if (CLOSED.includes(stop.status as StopStatus) && CLOSED.includes(input.status)) {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.STOP_ALREADY_CLOSED,
        message: `L’arrêt ${stop.order.number} est déjà clôturé (${stop.status}).`,
      });
    }

    const now = new Date();
    const cash = input.status === 'DELIVERED' ? (input.cashCollected ?? stop.order.total - stop.order.paidTotal) : 0n;

    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryRunStop.update({
        where: { id: stopId },
        data: {
          status: input.status,
          failureReason: input.failureReason ?? null,
          note: input.note ?? stop.note,
          proofMediaId: input.proofMediaId ?? stop.proofMediaId,
          cashCollected: cash,
          arrivedAt: stop.arrivedAt ?? now,
          completedAt: CLOSED.includes(input.status) ? now : null,
        },
      });

      if (input.status === 'DELIVERED' && cash > 0n) {
        const existing = await tx.codCollection.findFirst({
          where: { orderId: stop.orderId, driverId: stop.run.driverId },
          select: { id: true },
        });
        if (!existing) {
          await tx.codCollection.create({
            data: {
              orderId: stop.orderId,
              driverId: stop.run.driverId,
              amount: cash,
              collectedAt: now,
              note: `Tournée ${runId.slice(0, 8)}`,
            },
          });
        }
      }

      // The run leaves PLANNED the moment a driver reports anything.
      if (stop.run.status === 'PLANNED') {
        await tx.deliveryRun.update({
          where: { id: runId },
          data: { status: 'IN_PROGRESS', startedAt: now },
        });
      }
    });

    const nextStatus = orderStatusFor(input.status);
    if (nextStatus && nextStatus !== stop.order.status) {
      await this.transitions
        .transition(
          stop.orderId,
          {
            to: nextStatus,
            reason: input.note ?? `Tournée : ${input.status}`,
            failureReason: input.failureReason ?? undefined,
            ...(input.status === 'DELIVERED' ? { cashCollected: cash } : {}),
          },
          actor,
        )
        .catch((error: Error) => {
          this.logger.warn(`Order ${stop.order.number} would not move: ${error.message}`);
        });
    }

    await this.refreshCollectedCash(runId);
    return this.get(runId, forDriverId);
  }

  // --- manifest -------------------------------------------------------------

  /** The sheet the driver signs, and the office keeps. */
  async manifest(id: string): Promise<{ pdf: Buffer; filename: string }> {
    const run = await this.prisma.deliveryRun.findUnique({
      where: { id },
      include: this.runInclude(),
    });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });

    const dto = await this.toDto(run, true);
    const shopName = await this.settings.get<string>('shop.name', "Jeck's");

    const pdf = renderManifest({
      runCode: run.code,
      date: run.date,
      driverName: run.driver.user.name,
      driverPhone: run.driver.phone,
      vehicleLabel: run.vehicle ? `${run.vehicle.label} ${run.vehicle.plate}` : null,
      shopName,
      stops: dto.stops.map((stop) => ({
        position: stop.position,
        orderNumber: stop.orderNumber,
        customerName: stop.customerName,
        customerPhone: stop.customerPhone,
        address: stop.address,
        communeName: stop.communeName,
        wilayaName: stop.wilayaName,
        itemCount: stop.itemCount,
        codAmountMinor: BigInt(stop.codAmountMinor),
      })),
      expectedCashMinor: BigInt(dto.expectedCashMinor),
      distanceKm: dto.distanceKm,
      printedAt: new Date(),
    });

    await this.storage.put(`manifests/${run.code}.pdf`, pdf).catch((error: Error) => {
      this.logger.warn(`Could not store the manifest: ${error.message}`);
    });

    return { pdf, filename: `tournee-${run.code}.pdf` };
  }

  // --- helpers --------------------------------------------------------------

  private async requireEditable(id: string) {
    const run = await this.prisma.deliveryRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });

    if (run.status === 'COMPLETED' || run.status === 'CANCELLED') {
      throw new BadRequestException({
        code: DELIVERY_ERRORS.RUN_CLOSED,
        message: 'Cette tournée est clôturée.',
      });
    }
    return run;
  }

  /** Sequential per day, so a driver can say "tournée 2" over the radio. */
  private async nextCode(date: Date): Promise<string> {
    const stamp = date.toISOString().slice(2, 10).replace(/-/g, '');
    const count = await this.prisma.deliveryRun.count({ where: { date } });
    return `T-${stamp}-${count + 1}`;
  }

  private async resequence(runId: string): Promise<void> {
    const stops = await this.prisma.deliveryRunStop.findMany({
      where: { runId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    await this.prisma.$transaction(
      stops.map((stop, index) =>
        this.prisma.deliveryRunStop.update({ where: { id: stop.id }, data: { position: index + 1 } }),
      ),
    );
  }

  private async refreshExpectedCash(runId: string): Promise<void> {
    const stops = await this.prisma.deliveryRunStop.findMany({
      where: { runId },
      select: { order: { select: { total: true, paidTotal: true, paymentStatus: true } } },
    });

    const expected = stops.reduce(
      (total, stop) =>
        total +
        (stop.order.paymentStatus === 'PAID'
          ? 0n
          : bigMax(stop.order.total - stop.order.paidTotal, 0n)),
      0n,
    );

    await this.prisma.deliveryRun.update({ where: { id: runId }, data: { expectedCash: expected } });
  }

  private async refreshCollectedCash(runId: string): Promise<void> {
    const collected = await this.prisma.deliveryRunStop.aggregate({
      where: { runId },
      _sum: { cashCollected: true },
    });

    await this.prisma.deliveryRun.update({
      where: { id: runId },
      data: { collectedCash: collected._sum.cashCollected ?? 0n },
    });
  }

  /** The warehouse a run starts from, when it has coordinates. */
  private async depot(): Promise<{ latitude: number; longitude: number } | null> {
    const location = await this.prisma.location.findFirst({
      where: { isDefault: true },
      select: { wilaya: { select: { latitude: true, longitude: true } } },
    });

    const wilaya = location?.wilaya;
    if (!wilaya?.latitude || !wilaya.longitude) return null;

    return { latitude: Number(wilaya.latitude), longitude: Number(wilaya.longitude) };
  }

  private runInclude() {
    return {
      driver: { select: { id: true, phone: true, user: { select: { name: true } } } },
      vehicle: { select: { id: true, label: true, plate: true } },
      stops: {
        orderBy: { position: 'asc' },
        include: {
          order: {
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
              paymentStatus: true,
              commune: { select: { latitude: true, longitude: true } },
              wilaya: { select: { latitude: true, longitude: true } },
            },
          },
        },
      },
    } satisfies Prisma.DeliveryRunInclude;
  }

  private async toDto(
    run: Prisma.DeliveryRunGetPayload<{ include: ReturnType<RunsService['runInclude']> }>,
    withStops: boolean,
  ): Promise<DeliveryRunDto> {
    const stops: DeliveryRunStopDto[] = run.stops.map((stop) => {
      const point = coordinatesOf(stop.order);
      const cod =
        stop.order.paymentStatus === 'PAID'
          ? 0n
          : bigMax(stop.order.total - stop.order.paidTotal, 0n);

      return {
        id: stop.id,
        position: stop.position,
        orderId: stop.orderId,
        orderNumber: stop.order.number,
        customerName: stop.order.customerName,
        customerPhone: stop.order.customerPhone,
        address: stop.order.address,
        communeName: stop.order.communeName,
        wilayaName: stop.order.wilayaName,
        wilayaCode: stop.order.wilayaCode,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        itemCount: stop.order.itemCount,
        status: stop.status as StopStatus,
        codAmountMinor: cod.toString(),
        cashCollectedMinor: stop.cashCollected.toString(),
        failureReason: stop.failureReason,
        note: stop.note,
        proofMediaId: stop.proofMediaId,
        proofUrl: null,
        arrivedAt: stop.arrivedAt?.toISOString() ?? null,
        completedAt: stop.completedAt?.toISOString() ?? null,
      };
    });

    const depot = await this.depot();
    const routable: RoutableStop[] = stops
      .filter((stop) => stop.latitude !== null && stop.longitude !== null)
      .map((stop) => ({ id: stop.id, latitude: stop.latitude!, longitude: stop.longitude! }));

    return {
      id: run.id,
      code: run.code,
      date: run.date.toISOString().slice(0, 10),
      status: run.status as DeliveryRunStatusValue,
      driverId: run.driverId,
      driverName: run.driver.user.name,
      driverPhone: run.driver.phone,
      vehicleId: run.vehicle?.id ?? null,
      vehicleLabel: run.vehicle ? `${run.vehicle.label} ${run.vehicle.plate}` : null,
      note: run.note,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.endedAt?.toISOString() ?? null,
      stopCount: stops.length,
      deliveredCount: stops.filter((stop) => stop.status === 'DELIVERED').length,
      failedCount: stops.filter((stop) => stop.status === 'FAILED').length,
      expectedCashMinor: run.expectedCash.toString(),
      collectedCashMinor: run.collectedCash.toString(),
      distanceKm: Math.round(routeLengthKm(depot, routable) * 10) / 10,
      stops: withStops ? stops : [],
    };
  }
}

/**
 * Where a stop is: the commune when we know it, otherwise the wilaya centroid.
 *
 * A wilaya centroid is a poor address and a perfectly good ordering hint — it puts
 * Tamanrasset after Blida, which is the decision the route actually needs.
 */
function coordinatesOf(order: {
  commune: { latitude: unknown; longitude: unknown } | null;
  wilaya: { latitude: unknown; longitude: unknown } | null;
}): { latitude: number; longitude: number } | null {
  for (const source of [order.commune, order.wilaya]) {
    if (!source?.latitude || !source.longitude) continue;
    const point = { latitude: Number(source.latitude), longitude: Number(source.longitude) };
    if (isLocated(point)) return point;
  }
  return null;
}

/** A stop outcome, in the order state machine's vocabulary. */
function orderStatusFor(status: StopStatus): OrderStatus | null {
  if (status === 'DELIVERED') return OrderStatus.DELIVERED;
  if (status === 'FAILED') return OrderStatus.FAILED;
  // Arriving and rescheduling change nothing about the order itself.
  return null;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
