import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourierRegistry } from '../couriers/courier-registry.service.js';
import { ShipmentsService } from './shipments.service.js';

/**
 * Polling couriers that do not push — PRD F-AD-61.
 *
 * Only one of the four Algerian couriers sends webhooks. For the rest, "did it arrive"
 * is a question we have to keep asking, so the worker calls this on a schedule and it
 * asks each configured courier about the parcels still in the air.
 *
 * The work happens here rather than in the worker because the adapters and the
 * credentials live here. The worker owns the clock; the API owns the integration.
 */

/** Acts as the system: these updates have no person behind them. */
const SYSTEM_ACTOR = { id: null, name: 'Courier sync' };

export interface SyncReport {
  couriers: Array<{
    courierId: string;
    courierName: string;
    polled: number;
    applied: number;
    error?: string;
  }>;
  polled: number;
  applied: number;
}

@Injectable()
export class CourierSyncService {
  private readonly logger = new Logger(CourierSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierRegistry,
    private readonly shipments: ShipmentsService,
  ) {}

  /**
   * Asks every configured courier about their open parcels.
   *
   * One courier failing does not stop the others: an expired API key at one carrier
   * must not silently freeze tracking for the whole shop. Each failure is reported and
   * the loop continues.
   */
  async syncAll(limitPerCourier = 200): Promise<SyncReport> {
    const couriers = await this.prisma.courier.findMany({
      where: { active: true },
      select: { id: true, name: true, provider: true },
    });

    const report: SyncReport = { couriers: [], polled: 0, applied: 0 };

    for (const courier of couriers) {
      const adapter = this.registry.adapterFor(courier.provider);

      // A courier that pushes has nothing to be asked, and the manual one has nobody
      // to ask; polling either would be a wasted request every twenty minutes.
      if (adapter.supportsWebhook || adapter.key === 'manual') continue;

      const trackingNumbers = await this.shipments.openTrackingNumbers(courier.id, limitPerCourier);
      if (trackingNumbers.length === 0) continue;

      try {
        const credentials = await this.registry.assertReady(courier.id, courier.provider);
        const updates = await adapter.track(trackingNumbers, credentials);

        let applied = 0;
        for (const update of updates) {
          const result = await this.shipments.applyUpdate(update, SYSTEM_ACTOR);
          if (result === 'applied') applied += 1;
        }

        report.couriers.push({
          courierId: courier.id,
          courierName: courier.name,
          polled: trackingNumbers.length,
          applied,
        });
        report.polled += trackingNumbers.length;
        report.applied += applied;
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(`Could not poll ${courier.name}: ${message}`);
        report.couriers.push({
          courierId: courier.id,
          courierName: courier.name,
          polled: 0,
          applied: 0,
          error: message,
        });
      }
    }

    return report;
  }
}
