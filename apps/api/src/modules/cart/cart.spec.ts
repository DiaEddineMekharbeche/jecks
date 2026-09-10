import { describe, expect, it } from 'vitest';
import { availableOf, capQuantity } from './cart.service.js';

/**
 * The two decisions that make a cart honest: how much stock there actually is, and how
 * much of it a shopper is allowed to hold. Both are pure, so they are tested here
 * rather than through a controller.
 */

describe('availableOf', () => {
  it('sums available stock across locations', () => {
    expect(
      availableOf([
        { onHand: 10, reserved: 2 },
        { onHand: 5, reserved: 0 },
      ]),
    ).toBe(13);
  });

  it('clamps an oversold location at zero rather than hiding stock elsewhere', () => {
    // A warehouse holding one unit against four reservations contributes nothing;
    // letting it contribute -3 would hide three real units in the other location.
    expect(
      availableOf([
        { onHand: 1, reserved: 4 },
        { onHand: 6, reserved: 0 },
      ]),
    ).toBe(6);
  });

  it('is zero for a variant that has never been stocked', () => {
    expect(availableOf([])).toBe(0);
  });
});

describe('capQuantity', () => {
  const tracked = { trackInventory: true, allowBackorder: false };
  const untracked = { trackInventory: false, allowBackorder: false };
  const backorder = { trackInventory: true, allowBackorder: true };

  it('lets a shopper take what is on the shelf', () => {
    expect(capQuantity(3, 10, tracked)).toBe(3);
  });

  it('trims a request to what is left', () => {
    expect(capQuantity(8, 3, tracked)).toBe(3);
  });

  it('returns zero when nothing is left', () => {
    expect(capQuantity(2, 0, tracked)).toBe(0);
    expect(capQuantity(2, -5, tracked)).toBe(0);
  });

  it('does not cap a product that does not track inventory', () => {
    expect(capQuantity(40, 0, untracked)).toBe(40);
  });

  it('does not cap a product that accepts backorders', () => {
    expect(capQuantity(12, 1, backorder)).toBe(12);
  });

  it('never exceeds the per-line ceiling, whatever the stock', () => {
    expect(capQuantity(500, 900, tracked)).toBe(99);
    expect(capQuantity(500, 0, untracked)).toBe(99);
  });

  it('treats zero and fractions as a removal or a whole number', () => {
    expect(capQuantity(0, 10, tracked)).toBe(0);
    expect(capQuantity(2.9, 10, tracked)).toBe(2);
    expect(capQuantity(-4, 10, tracked)).toBe(0);
  });
});
