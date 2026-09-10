import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Order numbering — PRD F-AD-91, format `JK-{YYMMDD}-{SEQ}`.
 *
 * The number is read out on the telephone twenty times a day, so it is short, has no
 * ambiguous characters, and carries its date. The sequence restarts daily, which keeps
 * it to four digits for a shop doing hundreds of orders a day.
 *
 * Allocation takes a Postgres advisory lock on the day rather than reading the maximum
 * and adding one. Two checkouts landing in the same millisecond would otherwise both
 * read the same maximum, and the second would fail on the unique index — turning a
 * busy minute into a lost sale.
 */
@Injectable()
export class OrderNumberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async next(tx: Prisma.TransactionClient, now = new Date()): Promise<string> {
    const format = await this.settings.get<string>('orders.number_format', 'JK-{YYMMDD}-{SEQ}');
    const stamp = dayStamp(now);
    const prefix = format.replace('{YYMMDD}', stamp).replace('{SEQ}', '');

    // One lock per day, derived from the stamp. Held until the transaction ends, so the
    // window between reading the last number and writing the new one is closed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey(stamp)})`;

    const last = await tx.order.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const sequence = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(Number.isFinite(sequence) ? sequence : 1).padStart(4, '0')}`;
  }
}

export function dayStamp(date: Date): string {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * A stable 63-bit key for the advisory lock.
 *
 * `YYMMDD` is already numeric and unique per day, so it needs no hashing; the offset
 * keeps it clear of any other advisory lock the application might take.
 */
export function lockKey(stamp: string): bigint {
  return 7_000_000n + BigInt(stamp);
}
