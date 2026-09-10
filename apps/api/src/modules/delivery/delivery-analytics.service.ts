import { Injectable } from '@nestjs/common';
import { ShipmentStatus, type DeliveryFailureReason } from '@jecks/db';
import type { DeliveryAnalytics } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Delivery analytics — PRD F-AD-65.
 *
 * The question a COD shop lives or dies by is which courier actually delivers, and
 * where. A 78 % success rate in Alger and 44 % in Ouargla is not one number, so nothing
 * here reports a shop-wide average without also breaking it down.
 *
 * The rate counts finished parcels only. Counting delivered against everything shipped
 * would make a courier look worse the busier they are, because parcels still in transit
 * would sit in the denominator.
 */

const FINAL: ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.FAILED,
  ShipmentStatus.RETURNED,
];

@Injectable()
export class DeliveryAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(from: Date, to: Date): Promise<DeliveryAnalytics> {
    const start = startOfDay(from);
    const end = new Date(startOfDay(to).getTime() + 86_400_000);

    const shipments = await this.prisma.shipment.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        status: true,
        cost: true,
        failureReason: true,
        shippedAt: true,
        deliveredAt: true,
        createdAt: true,
        courierId: true,
        courier: { select: { name: true } },
        order: { select: { wilayaCode: true, wilayaName: true, shippingTotal: true } },
      },
    });

    const delivered = shipments.filter((row) => row.status === ShipmentStatus.DELIVERED);
    const failed = shipments.filter((row) => row.status === ShipmentStatus.FAILED);
    const returned = shipments.filter((row) => row.status === ShipmentStatus.RETURNED);
    const finished = shipments.filter((row) => FINAL.includes(row.status));

    // --- per courier ---------------------------------------------------------
    const byCourierMap = new Map<
      string,
      {
        courierId: string | null;
        courierName: string;
        shipped: number;
        delivered: number;
        failed: number;
        finished: number;
        hours: number[];
        cost: bigint;
      }
    >();

    for (const shipment of shipments) {
      const key = shipment.courierId ?? 'fleet';
      const entry =
        byCourierMap.get(key) ??
        {
          courierId: shipment.courierId,
          courierName: shipment.courier?.name ?? 'Flotte interne',
          shipped: 0,
          delivered: 0,
          failed: 0,
          finished: 0,
          hours: [] as number[],
          cost: 0n,
        };

      entry.shipped += 1;
      entry.cost += shipment.cost;
      if (FINAL.includes(shipment.status)) entry.finished += 1;
      if (shipment.status === ShipmentStatus.DELIVERED) {
        entry.delivered += 1;
        const hours = transitHours(shipment);
        if (hours !== null) entry.hours.push(hours);
      }
      if (shipment.status === ShipmentStatus.FAILED) entry.failed += 1;

      byCourierMap.set(key, entry);
    }

    // --- per wilaya ----------------------------------------------------------
    const byWilayaMap = new Map<
      number,
      { wilayaCode: number; wilayaName: string; shipped: number; delivered: number; failed: number; finished: number }
    >();

    for (const shipment of shipments) {
      const code = shipment.order.wilayaCode;
      const entry =
        byWilayaMap.get(code) ??
        {
          wilayaCode: code,
          wilayaName: shipment.order.wilayaName,
          shipped: 0,
          delivered: 0,
          failed: 0,
          finished: 0,
        };

      entry.shipped += 1;
      if (FINAL.includes(shipment.status)) entry.finished += 1;
      if (shipment.status === ShipmentStatus.DELIVERED) entry.delivered += 1;
      if (shipment.status === ShipmentStatus.FAILED) entry.failed += 1;

      byWilayaMap.set(code, entry);
    }

    // --- reasons -------------------------------------------------------------
    const reasons = new Map<DeliveryFailureReason, number>();
    for (const shipment of [...failed, ...returned]) {
      if (!shipment.failureReason) continue;
      reasons.set(shipment.failureReason, (reasons.get(shipment.failureReason) ?? 0) + 1);
    }

    // --- daily series --------------------------------------------------------
    const series = new Map<string, { date: string; shipped: number; delivered: number; failed: number }>();
    for (let day = new Date(start); day < end; day = new Date(day.getTime() + 86_400_000)) {
      const key = day.toISOString().slice(0, 10);
      series.set(key, { date: key, shipped: 0, delivered: 0, failed: 0 });
    }

    for (const shipment of shipments) {
      const key = shipment.createdAt.toISOString().slice(0, 10);
      const entry = series.get(key);
      if (entry) entry.shipped += 1;
    }
    for (const shipment of delivered) {
      const key = (shipment.deliveredAt ?? shipment.createdAt).toISOString().slice(0, 10);
      const entry = series.get(key);
      if (entry) entry.delivered += 1;
    }
    for (const shipment of failed) {
      const key = shipment.createdAt.toISOString().slice(0, 10);
      const entry = series.get(key);
      if (entry) entry.failed += 1;
    }

    const allHours = delivered.map(transitHours).filter((value): value is number => value !== null);

    return {
      from: start.toISOString().slice(0, 10),
      to: startOfDay(to).toISOString().slice(0, 10),
      shipped: shipments.length,
      delivered: delivered.length,
      failed: failed.length,
      returned: returned.length,
      successRate: percentage(delivered.length, finished.length),
      averageHours: average(allHours),
      shippingCostMinor: shipments.reduce((sum, row) => sum + row.cost, 0n).toString(),
      shippingRevenueMinor: shipments
        .reduce((sum, row) => sum + row.order.shippingTotal, 0n)
        .toString(),
      byCourier: [...byCourierMap.values()]
        .map((entry) => ({
          courierId: entry.courierId,
          courierName: entry.courierName,
          shipped: entry.shipped,
          delivered: entry.delivered,
          failed: entry.failed,
          successRate: percentage(entry.delivered, entry.finished),
          averageHours: average(entry.hours),
          costMinor: entry.cost.toString(),
        }))
        .sort((a, b) => b.shipped - a.shipped),
      byWilaya: [...byWilayaMap.values()]
        .map((entry) => ({
          wilayaCode: entry.wilayaCode,
          wilayaName: entry.wilayaName,
          shipped: entry.shipped,
          delivered: entry.delivered,
          failed: entry.failed,
          successRate: percentage(entry.delivered, entry.finished),
        }))
        .sort((a, b) => b.shipped - a.shipped),
      byFailureReason: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      series: [...series.values()],
    };
  }
}

/** Hours from handing the parcel over to the doorstep. */
function transitHours(shipment: { shippedAt: Date | null; deliveredAt: Date | null; createdAt: Date }): number | null {
  if (!shipment.deliveredAt) return null;
  const start = shipment.shippedAt ?? shipment.createdAt;
  const hours = (shipment.deliveredAt.getTime() - start.getTime()) / 3_600_000;
  // A negative span means the clock or the courier lied; excluding it beats averaging it.
  return hours >= 0 ? hours : null;
}

function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
