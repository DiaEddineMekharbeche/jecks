import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The signed-in user's own notifications — PRD Section 6.1, M3.4.
 *
 * The worker already writes these rows: an in-app notification has no transport, so the
 * row is the delivery. Until now nothing read them back, which meant the low-stock alert
 * and the failed-delivery alert were written faithfully to a table nobody opened.
 *
 * Two kinds arrive here. One is addressed to a person — `userId` is set — and the other
 * has no user at all, because "stock is low" is for whoever is minding the shop rather
 * than for a named individual. Both show in the same list.
 */

export interface NotificationRow {
  id: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  /** True for a shop-wide alert with no named recipient. */
  shared: boolean;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationRow[];
  unread: number;
}

/** Enough to fill the panel; older ones are history, not a to-do list. */
const LIMIT = 50;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(userId: string): Promise<NotificationFeed> {
    const where = this.mine(userId);

    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return { items: rows.map(toRow), unread };
  }

  /** Just the count, for the badge. Cheap enough to poll. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { ...this.mine(userId), readAt: null },
    });

    return { unread };
  }

  async markRead(userId: string, id: string): Promise<NotificationRow> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, ...this.mine(userId) },
    });

    if (!existing) {
      // Not found rather than forbidden: whether somebody else's notification exists is
      // not a question this endpoint should answer.
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification introuvable' });
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
    });

    return toRow(updated);
  }

  async markAllRead(userId: string): Promise<{ read: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.mine(userId), readAt: null },
      data: { readAt: new Date() },
    });

    return { read: result.count };
  }

  /**
   * Mine, plus the shop's.
   *
   * A shared alert marked read disappears for everybody, which is the useful behaviour
   * in a shop with a handful of staff: once somebody has dealt with the low stock, the
   * others do not need to see it again. Per-person read state on a shared row would need
   * a join table and would leave four people each dismissing the same alert.
   */
  private mine(userId: string) {
    return {
      channel: 'IN_APP' as const,
      OR: [{ userId }, { userId: null }],
    };
  }
}

function toRow(row: {
  id: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  userId: string | null;
  createdAt: Date;
}): NotificationRow {
  return {
    id: row.id,
    event: row.event,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    shared: row.userId === null,
    createdAt: row.createdAt.toISOString(),
  };
}
