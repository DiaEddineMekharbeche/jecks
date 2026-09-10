import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, StockMovementReason } from '@jecks/db';
import { INVENTORY_ERRORS } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The one place stock changes — PRD F-AD-50, and the contract every other module
 * (orders, returns, purchasing, counts) goes through.
 *
 * The rule is that `inventory_levels` is a cache and `stock_movements` is the record.
 * A caller never updates a level itself: it posts a signed movement and gets the new
 * balance back. That is what lets an operator answer "where did those four units go"
 * a month later, and what makes reserve/release symmetric instead of approximate.
 *
 * Concurrency is handled by doing the read and the write inside one transaction with a
 * row lock on the level. Two agents confirming the same last unit at the same moment
 * must not both succeed, and an optimistic read outside a transaction cannot promise
 * that.
 */

export interface PostMovementInput {
  variantId: string;
  locationId: string;
  /** Signed: negative removes stock. */
  quantity: number;
  reason: StockMovementReason;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  actorId?: string | null;
  /** Refuses the movement when it would push available stock below zero. */
  allowNegative?: boolean;
}

export interface MovementResult {
  movementId: string;
  variantId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
}

@Injectable()
export class StockLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Posts one movement in its own transaction. */
  async post(input: PostMovementInput): Promise<MovementResult> {
    return this.prisma.$transaction((tx) => this.postWithin(tx, input));
  }

  /** Posts several movements atomically — a transfer, or a whole order's lines. */
  async postMany(inputs: PostMovementInput[]): Promise<MovementResult[]> {
    return this.prisma.$transaction(async (tx) => {
      const results: MovementResult[] = [];
      for (const input of inputs) results.push(await this.postWithin(tx, input));
      return results;
    });
  }

  /**
   * The transactional core. Exposed so a caller already inside a transaction (order
   * confirmation, purchase receipt) posts its movements in the same unit of work.
   */
  async postWithin(tx: Prisma.TransactionClient, input: PostMovementInput): Promise<MovementResult> {
    const quantity = Math.trunc(input.quantity);
    const level = await this.lockLevel(tx, input.variantId, input.locationId);

    const onHand = level.onHand + quantity;

    if (!input.allowNegative && quantity < 0 && onHand - level.reserved < 0) {
      throw new BadRequestException({
        code: INVENTORY_ERRORS.INSUFFICIENT_STOCK,
        message: `Only ${level.onHand - level.reserved} unit(s) available; asked for ${-quantity}`,
        details: {
          variantId: input.variantId,
          locationId: input.locationId,
          available: level.onHand - level.reserved,
          requested: -quantity,
        },
      });
    }

    await tx.inventoryLevel.update({
      where: { variantId_locationId: { variantId: input.variantId, locationId: input.locationId } },
      data: { onHand },
    });

    // A zero-quantity movement is still recorded. "We counted and nothing had moved"
    // is information, and dropping it leaves a gap in the ledger for that day.
    const movement = await tx.stockMovement.create({
      data: {
        variantId: input.variantId,
        locationId: input.locationId,
        quantity,
        reason: input.reason,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        note: input.note ?? null,
        actorId: input.actorId ?? null,
        balanceAfter: onHand,
      },
      select: { id: true },
    });

    return {
      movementId: movement.id,
      variantId: input.variantId,
      locationId: input.locationId,
      onHand,
      reserved: level.reserved,
      available: onHand - level.reserved,
    };
  }

  /**
   * Moves units between `onHand` and `reserved` without changing the total.
   *
   * A reservation is not a movement of goods, so it does not write the ledger by
   * default: the goods are still on the shelf, merely spoken for. `RESERVATION` and
   * `RELEASE` exist as reasons for the cases where an operator does want the trail.
   */
  async reserveWithin(
    tx: Prisma.TransactionClient,
    variantId: string,
    locationId: string,
    quantity: number,
    options: { allowNegative?: boolean } = {},
  ): Promise<MovementResult> {
    const delta = Math.trunc(quantity);
    const level = await this.lockLevel(tx, variantId, locationId);
    const reserved = level.reserved + delta;

    if (!options.allowNegative && delta > 0 && level.onHand - reserved < 0) {
      throw new BadRequestException({
        code: INVENTORY_ERRORS.INSUFFICIENT_STOCK,
        message: `Only ${level.onHand - level.reserved} unit(s) available; asked to hold ${delta}`,
        details: { variantId, locationId, available: level.onHand - level.reserved, requested: delta },
      });
    }

    // A release can never take the held count below zero, whatever the caller passes:
    // that would turn a double-release into phantom stock.
    const next = Math.max(reserved, 0);
    await tx.inventoryLevel.update({
      where: { variantId_locationId: { variantId, locationId } },
      data: { reserved: next },
    });

    return {
      movementId: '',
      variantId,
      locationId,
      onHand: level.onHand,
      reserved: next,
      available: level.onHand - next,
    };
  }

  /** Adds to `incoming` when a purchase order is placed, removes it when it lands. */
  async adjustIncomingWithin(
    tx: Prisma.TransactionClient,
    variantId: string,
    locationId: string,
    delta: number,
  ): Promise<void> {
    const level = await this.lockLevel(tx, variantId, locationId);
    await tx.inventoryLevel.update({
      where: { variantId_locationId: { variantId, locationId } },
      data: { incoming: Math.max(level.incoming + Math.trunc(delta), 0) },
    });
  }

  /**
   * Reads the level for update, creating it if the pair has never been stocked.
   *
   * `FOR UPDATE` is raw because Prisma has no row-lock API. Creating the row first,
   * outside the lock, is what makes the lock possible at all: you cannot lock a row
   * that does not exist yet, and two concurrent creates are resolved by the unique
   * index rather than by a race.
   */
  private async lockLevel(
    tx: Prisma.TransactionClient,
    variantId: string,
    locationId: string,
  ): Promise<{ onHand: number; reserved: number; incoming: number }> {
    await tx.$executeRaw`
      INSERT INTO inventory_levels (id, "variantId", "locationId", "onHand", reserved, incoming, "updatedAt")
      VALUES (gen_random_uuid(), ${variantId}::uuid, ${locationId}::uuid, 0, 0, 0, NOW())
      ON CONFLICT ("variantId", "locationId") DO NOTHING
    `;

    const rows = await tx.$queryRaw<Array<{ onHand: number; reserved: number; incoming: number }>>`
      SELECT "onHand", reserved, incoming
      FROM inventory_levels
      WHERE "variantId" = ${variantId}::uuid AND "locationId" = ${locationId}::uuid
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) {
      throw new BadRequestException({
        code: 'INVENTORY_LEVEL_MISSING',
        message: 'That variant and location pair could not be locked',
        details: { variantId, locationId },
      });
    }
    return { onHand: Number(row.onHand), reserved: Number(row.reserved), incoming: Number(row.incoming) };
  }
}
