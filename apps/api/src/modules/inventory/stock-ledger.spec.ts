import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { StockLedgerService } from './stock-ledger.service.js';

/**
 * The ledger is thin on purpose, so these tests exercise it against a fake transaction
 * client rather than a database: what has to be proved is the arithmetic and the
 * refusals, not that Prisma can write a row.
 */

interface FakeLevel {
  onHand: number;
  reserved: number;
  incoming: number;
}

function fakeTx(levels: Record<string, FakeLevel>) {
  const movements: Array<Record<string, unknown>> = [];

  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const key = `${String(values[0])}:${String(values[1])}`;
      levels[key] ??= { onHand: 0, reserved: 0, incoming: 0 };
      return [levels[key]];
    },
    inventoryLevel: {
      update: async ({
        where,
        data,
      }: {
        where: { variantId_locationId: { variantId: string; locationId: string } };
        data: Partial<FakeLevel>;
      }) => {
        const key = `${where.variantId_locationId.variantId}:${where.variantId_locationId.locationId}`;
        levels[key] = { ...(levels[key] as FakeLevel), ...data };
        return levels[key];
      },
    },
    stockMovement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        movements.push(data);
        return { id: `movement-${movements.length}` };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, movements, levels };
}

const VARIANT = '11111111-1111-1111-1111-111111111111';
const LOCATION = '22222222-2222-2222-2222-222222222222';
const KEY = `${VARIANT}:${LOCATION}`;

describe('StockLedgerService.postWithin', () => {
  let service: StockLedgerService;

  beforeEach(() => {
    service = new StockLedgerService({} as never);
  });

  it('adds units and records the resulting balance', async () => {
    const { tx, movements, levels } = fakeTx({ [KEY]: { onHand: 4, reserved: 0, incoming: 0 } });

    const result = await service.postWithin(tx, {
      variantId: VARIANT,
      locationId: LOCATION,
      quantity: 20,
      reason: 'PURCHASE',
    });

    expect(result.onHand).toBe(24);
    expect(result.available).toBe(24);
    expect(levels[KEY]?.onHand).toBe(24);
    expect(movements[0]).toMatchObject({ quantity: 20, balanceAfter: 24, reason: 'PURCHASE' });
  });

  it('refuses to remove more than is available', async () => {
    const { tx, movements } = fakeTx({ [KEY]: { onHand: 5, reserved: 3, incoming: 0 } });

    await expect(
      service.postWithin(tx, {
        variantId: VARIANT,
        locationId: LOCATION,
        quantity: -3,
        reason: 'SALE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(movements).toHaveLength(0);
  });

  it('lets a correction take stock negative when the caller says so', async () => {
    const { tx, levels } = fakeTx({ [KEY]: { onHand: 1, reserved: 0, incoming: 0 } });

    const result = await service.postWithin(tx, {
      variantId: VARIANT,
      locationId: LOCATION,
      quantity: -4,
      reason: 'ADJUSTMENT',
      allowNegative: true,
    });

    expect(result.onHand).toBe(-3);
    expect(levels[KEY]?.onHand).toBe(-3);
  });

  it('records a zero movement rather than skipping it', async () => {
    const { tx, movements } = fakeTx({ [KEY]: { onHand: 7, reserved: 0, incoming: 0 } });

    await service.postWithin(tx, {
      variantId: VARIANT,
      locationId: LOCATION,
      quantity: 0,
      reason: 'STOCK_COUNT',
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ quantity: 0, balanceAfter: 7 });
  });

  it('truncates a fractional quantity instead of writing a fraction of a unit', async () => {
    const { tx, movements } = fakeTx({ [KEY]: { onHand: 0, reserved: 0, incoming: 0 } });

    await service.postWithin(tx, {
      variantId: VARIANT,
      locationId: LOCATION,
      quantity: 2.9,
      reason: 'PURCHASE',
    });

    expect(movements[0]).toMatchObject({ quantity: 2, balanceAfter: 2 });
  });
});

describe('StockLedgerService.reserveWithin', () => {
  const service = new StockLedgerService({} as never);

  it('holds units without changing on-hand', async () => {
    const { tx, movements, levels } = fakeTx({ [KEY]: { onHand: 10, reserved: 0, incoming: 0 } });

    const result = await service.reserveWithin(tx, VARIANT, LOCATION, 3);

    expect(result).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(levels[KEY]?.onHand).toBe(10);
    expect(movements).toHaveLength(0);
  });

  it('refuses to hold more than is available', async () => {
    const { tx } = fakeTx({ [KEY]: { onHand: 10, reserved: 8, incoming: 0 } });

    await expect(service.reserveWithin(tx, VARIANT, LOCATION, 3)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clamps a double release at zero rather than inventing stock', async () => {
    const { tx, levels } = fakeTx({ [KEY]: { onHand: 10, reserved: 2, incoming: 0 } });

    const result = await service.reserveWithin(tx, VARIANT, LOCATION, -5);

    expect(result.reserved).toBe(0);
    expect(result.available).toBe(10);
    expect(levels[KEY]?.reserved).toBe(0);
  });

  it('allows an oversell hold when the caller opts in', async () => {
    const { tx } = fakeTx({ [KEY]: { onHand: 1, reserved: 0, incoming: 0 } });

    const result = await service.reserveWithin(tx, VARIANT, LOCATION, 4, { allowNegative: true });

    expect(result.reserved).toBe(4);
    expect(result.available).toBe(-3);
  });
});

describe('StockLedgerService.adjustIncomingWithin', () => {
  const service = new StockLedgerService({} as never);

  it('adds and removes expected units, never going below zero', async () => {
    const { tx, levels } = fakeTx({ [KEY]: { onHand: 0, reserved: 0, incoming: 5 } });

    await service.adjustIncomingWithin(tx, VARIANT, LOCATION, 20);
    expect(levels[KEY]?.incoming).toBe(25);

    await service.adjustIncomingWithin(tx, VARIANT, LOCATION, -100);
    expect(levels[KEY]?.incoming).toBe(0);
  });
});
