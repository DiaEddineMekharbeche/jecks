import type { CartDto } from '@jecks/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cart store — PRD F-ST-41.
 *
 * `fetch` is stubbed rather than the API module: the store's contract is "whatever the
 * server returns becomes the cart, wholesale", and mocking the module in between would
 * test the mock instead of that.
 */

const BASE = 'http://localhost:4000/api/v1';

function cart(overrides: Partial<CartDto> = {}): CartDto {
  return {
    id: 'cart-1',
    token: 'token-1',
    itemCount: 2,
    items: [],
    currency: 'DZD',
    subtotalMinor: '200000',
    discountMinor: '0',
    shippingMinor: '50000',
    totalMinor: '250000',
    weightGrams: 360,
    wilayaCode: null,
    wilayaName: null,
    deliveryType: null,
    shippingQuoted: false,
    promotions: [],
    rejectedCodes: [],
    appliedCode: null,
    freeShippingThresholdMinor: null,
    freeShippingRemainingMinor: null,
    freeShipping: false,
    notices: [],
    updatedAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let useCart: typeof import('./cart-store')['useCart'];
let initial: ReturnType<typeof import('./cart-store')['useCart']['getState']>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  ({ useCart } = await import('./cart-store'));
  initial = useCart.getState();
});

afterEach(() => {
  useCart.setState(initial, true);
  vi.unstubAllGlobals();
});

const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

describe('load', () => {
  it('stores whatever the server returns', async () => {
    mockFetch().mockResolvedValue(ok(cart({ itemCount: 3 })));

    await useCart.getState().load();

    expect(useCart.getState().cart?.itemCount).toBe(3);
    expect(useCart.getState().loading).toBe(false);
  });

  it('leaves the cart empty and shows no banner when the read fails', async () => {
    // A cart that cannot be read is not worth an error on every page; the next
    // mutation surfaces the problem where the shopper is actually looking.
    mockFetch().mockRejectedValue(new Error('offline'));

    await useCart.getState().load();

    expect(useCart.getState().cart).toBeNull();
    expect(useCart.getState().error).toBeNull();
  });
});

describe('addItem', () => {
  it('replaces the cart and opens the drawer', async () => {
    mockFetch().mockResolvedValue(
      ok(
        cart({
          itemCount: 1,
          items: [
            {
              id: 'line-1',
              variantId: 'variant-1',
              productId: 'product-1',
              productName: { fr: 'Casquette' },
              productSlug: 'casquette',
              variantName: 'Noir / M',
              sku: 'CAP-NOI-M',
              imageUrl: null,
              quantity: 1,
              unitPriceMinor: '200000',
              currentUnitPriceMinor: '200000',
              compareAtPriceMinor: null,
              lineTotalMinor: '200000',
              discountMinor: '0',
              available: 5,
              adjusted: null,
            },
          ],
        }),
      ),
    );

    const added = await useCart.getState().addItem('variant-1', 1);

    expect(added).toBe(true);
    expect(useCart.getState().open).toBe(true);
    expect(useCart.getState().lastAddedId).toBe('line-1');
  });

  it('surfaces the server message when the variant just sold out', async () => {
    mockFetch().mockResolvedValue(fail(400, 'OUT_OF_STOCK', 'That item just sold out'));

    const added = await useCart.getState().addItem('variant-1', 1);

    expect(added).toBe(false);
    expect(useCart.getState().error).toBe('That item just sold out');
    expect(useCart.getState().open).toBe(false);
  });

  it('clears busy even after a failure', async () => {
    mockFetch().mockRejectedValue(new Error('network'));

    await useCart.getState().addItem('variant-1', 1);

    expect(useCart.getState().busy).toBe(false);
  });
});

describe('setQuantity', () => {
  it('marks the line pending while in flight and clears it afterwards', async () => {
    let resolve: ((value: Response) => void) | undefined;
    mockFetch().mockReturnValue(
      new Promise<Response>((settle) => {
        resolve = settle;
      }),
    );

    const pending = useCart.getState().setQuantity('line-1', 3);
    expect(useCart.getState().pendingLines).toContain('line-1');

    resolve?.(ok(cart()));
    await pending;

    expect(useCart.getState().pendingLines).not.toContain('line-1');
  });
});

describe('applyPromo', () => {
  it('shows the refusal reason verbatim', async () => {
    // The API's sentence is the reason the shopper needs; replacing it with a generic
    // failure would leave them retyping a code that can never work.
    mockFetch().mockResolvedValue(
      fail(400, 'PROMO_REJECTED', 'This code has reached its usage limit'),
    );

    const applied = await useCart.getState().applyPromo('SUMMER');

    expect(applied).toBe(false);
    expect(useCart.getState().error).toBe('This code has reached its usage limit');
  });

  it('stores the cart the server returns on success', async () => {
    mockFetch().mockResolvedValue(ok(cart({ appliedCode: 'SUMMER', discountMinor: '20000' })));

    const applied = await useCart.getState().applyPromo('SUMMER');

    expect(applied).toBe(true);
    expect(useCart.getState().cart?.appliedCode).toBe('SUMMER');
    expect(useCart.getState().error).toBeNull();
  });
});

describe('drawer', () => {
  it('forgets the highlighted line when it closes', () => {
    useCart.setState({ open: true, lastAddedId: 'line-1' });
    useCart.getState().setOpen(false);
    expect(useCart.getState().lastAddedId).toBeNull();
  });
});

describe('merge', () => {
  it('falls back to a plain read when merging fails', async () => {
    mockFetch()
      .mockResolvedValueOnce(fail(500, 'INTERNAL_ERROR', 'nope'))
      .mockResolvedValueOnce(ok(cart({ itemCount: 4 })));

    await useCart.getState().merge();

    expect(useCart.getState().cart?.itemCount).toBe(4);
  });
});

describe('request shape', () => {
  it('sends cookies, so the httpOnly cart token travels with every call', async () => {
    mockFetch().mockResolvedValue(ok(cart()));

    await useCart.getState().load();

    const [url, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/cart`);
    expect(init.credentials).toBe('include');
  });
});
