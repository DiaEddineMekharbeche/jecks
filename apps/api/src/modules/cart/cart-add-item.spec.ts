import { describe, expect, it, vi } from 'vitest';
import { CartService } from './cart.service.js';

/**
 * Adding something to the cart.
 *
 * This is the single most-used write in the shop and it was broken: the line was
 * written with an `upsert` whose `where` put `bundleId: null` inside a compound unique,
 * which Prisma rejects at runtime. Every add returned a 500. Nothing caught it, because
 * the only cart tests were of two pure helper functions.
 *
 * So these drive the service with a stubbed Prisma and assert on the calls it makes.
 */

interface Line {
  id: string;
  variantId: string;
  bundleId: string | null;
  quantity: number;
}

function makeService(options: { existing?: Line[]; onHand?: number } = {}) {
  const items = options.existing ?? [];

  const cart = {
    id: 'cart-1',
    token: 'tok_abcdefgh',
    customerId: null,
    items,
  };

  const prisma = {
    cart: {
      findFirst: vi.fn(async () => cart),
      findUnique: vi.fn(async () => cart),
      create: vi.fn(async () => cart),
      update: vi.fn(async () => cart),
    },
    variant: {
      findFirst: vi.fn(async () => ({
        id: 'variant-1',
        price: 390_000n,
        product: {
          status: 'ACTIVE',
          deletedAt: null,
          allowBackorder: false,
          trackInventory: true,
        },
        inventoryLevels: [{ onHand: options.onHand ?? 10, reserved: 0 }],
      })),
    },
    cartItem: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const service = new CartService(
    prisma as never,
    { evaluate: vi.fn(async () => ({ applied: [], rejected: [], orderDiscountMinor: 0n })) } as never,
    { quote: vi.fn(async () => null) } as never,
    { get: vi.fn(async (_key: string, fallback: unknown) => fallback) } as never,
    { publicUrl: vi.fn(() => null) } as never,
  );

  // `present` reloads the cart and builds the DTO; the assertions here are about the
  // write, so it is stubbed to keep the stub surface small.
  vi.spyOn(service as never as { present: () => unknown }, 'present').mockResolvedValue({
    token: cart.token,
    items: [],
  } as never);

  return { service, prisma, cart };
}

/** The first argument of the first call, which is what every Prisma assertion wants. */
function firstArg<T>(mock: { mock: { calls: unknown[][] } }): T {
  return mock.mock.calls[0]![0] as T;
}

const INPUT = { variantId: 'variant-1', quantity: 2 };

describe('CartService.addItem', () => {
  it('creates the line for a variant that is not in the cart yet', async () => {
    const { service, prisma } = makeService();

    await service.addItem('tok_abcdefgh', INPUT as never, null);

    expect(prisma.cartItem.create).toHaveBeenCalledOnce();
    const call = firstArg<{ data: Record<string, unknown> }>(prisma.cartItem.create);
    expect(call.data).toMatchObject({ cartId: 'cart-1', variantId: 'variant-1', quantity: 2 });
  });

  it('never passes a null through a compound unique, which Prisma refuses', async () => {
    // The exact shape of the bug. `upsert` on (cartId, variantId, bundleId) cannot be
    // used when bundleId is null, and using it threw on every single add.
    const { service, prisma } = makeService();

    await service.addItem('tok_abcdefgh', INPUT as never, null);

    expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it('adds to the quantity already in the cart rather than replacing it', async () => {
    const { service, prisma } = makeService({
      existing: [{ id: 'line-1', variantId: 'variant-1', bundleId: null, quantity: 1 }],
    });

    await service.addItem('tok_abcdefgh', INPUT as never, null);

    expect(prisma.cartItem.create).not.toHaveBeenCalled();
    const call = firstArg<{ where: { id: string }; data: { quantity: number } }>(
      prisma.cartItem.update,
    );
    expect(call.where.id).toBe('line-1');
    // One already there plus two more.
    expect(call.data.quantity).toBe(3);
  });

  it('does not merge into a line that belongs to a bundle', async () => {
    // A bundle line holds the same variant but is priced and removed as part of the
    // bundle. Merging a loose add into it would change what the customer bought.
    const { service, prisma } = makeService({
      existing: [{ id: 'line-bundle', variantId: 'variant-1', bundleId: 'bundle-9', quantity: 1 }],
    });

    await service.addItem('tok_abcdefgh', INPUT as never, null);

    expect(prisma.cartItem.update).not.toHaveBeenCalled();
    expect(prisma.cartItem.create).toHaveBeenCalledOnce();
  });

  it('caps the quantity at what is actually on the shelf', async () => {
    const { service, prisma } = makeService({ onHand: 3 });

    await service.addItem('tok_abcdefgh', { variantId: 'variant-1', quantity: 9 } as never, null);

    const call = firstArg<{ data: { quantity: number } }>(prisma.cartItem.create);
    expect(call.data.quantity).toBe(3);
  });

  it('refuses when the variant just sold out', async () => {
    const { service, prisma } = makeService({ onHand: 0 });

    await expect(service.addItem('tok_abcdefgh', INPUT as never, null)).rejects.toMatchObject({
      response: { code: 'OUT_OF_STOCK' },
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('opens a cart when the shopper has none', async () => {
    const { service, prisma } = makeService();

    await service.addItem(undefined, INPUT as never, null);

    expect(prisma.cart.create).toHaveBeenCalledOnce();
  });

  it('stores the price at the moment of adding, not at checkout', async () => {
    // The cart revalidates prices later, but the line has to start from what the
    // shopper was shown.
    const { service, prisma } = makeService();

    await service.addItem('tok_abcdefgh', INPUT as never, null);

    const call = firstArg<{ data: { unitPrice: bigint } }>(prisma.cartItem.create);
    expect(call.data.unitPrice).toBe(390_000n);
  });
});
