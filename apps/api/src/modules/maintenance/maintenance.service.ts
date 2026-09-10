import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { LoyaltyService } from '../customers/loyalty.service.js';
import { ExpensesService } from '../finance/expenses.service.js';
import { segmentOf } from '../customers/domain/segments.js';

/**
 * The work that happens while nobody is watching.
 *
 * Each task is separately callable so a failure in one does not hide the others, and
 * each reports what it did rather than succeeding silently: a segmentation run that
 * touches nothing for a week is a bug, and only the number makes that visible.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly loyalty: LoyaltyService,
    private readonly expenses: ExpensesService,
  ) {}

  async generateRecurringExpenses(): Promise<{ created: number }> {
    const result = await this.expenses.generateRecurring();
    if (result.created > 0) this.logger.log(`Generated ${result.created} recurring expense(s)`);
    return result;
  }

  /**
   * Recomputes every customer's segment from what they have actually done.
   *
   * Only customers whose segment would change are written. A nightly job that updates
   * every row rewrites the table for nothing and buries the real changes in the audit
   * trail.
   */
  async refreshSegments(limit: number): Promise<{ scanned: number; changed: number }> {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        segment: true,
        blacklisted: true,
        deliveredCount: true,
        lifetimeValue: true,
        lastOrderAt: true,
      },
    });

    const now = new Date();
    let changed = 0;

    for (const customer of customers) {
      const segment = segmentOf(
        {
          blacklisted: customer.blacklisted,
          deliveredCount: customer.deliveredCount,
          lifetimeValueMinor: customer.lifetimeValue,
          lastOrderAt: customer.lastOrderAt,
        },
        now,
      );

      if (segment === customer.segment) continue;

      await this.prisma.customer.update({ where: { id: customer.id }, data: { segment } });
      changed += 1;
    }

    return { scanned: customers.length, changed };
  }

  async expireLoyalty(): Promise<{ customers: number; points: number }> {
    const result = await this.loyalty.expireStale();
    if (result.points > 0) {
      this.logger.log(`Expired ${result.points} point(s) across ${result.customers} customer(s)`);
    }
    return result;
  }

  /** Repairs the cached rollups of customers whose orders moved recently. */
  async refreshRollups(since: Date): Promise<{ customers: number }> {
    const recent = await this.prisma.order.findMany({
      where: { updatedAt: { gte: since }, customerId: { not: null } },
      select: { customerId: true },
      distinct: ['customerId'],
      take: 5_000,
    });

    for (const order of recent) {
      await this.customers.refreshRollups(order.customerId!);
    }

    return { customers: recent.length };
  }
}
