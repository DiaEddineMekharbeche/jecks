import { OrderStatus, PaymentMethod, PaymentStatus } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  TERMINAL_STATUSES,
  allowedFrom,
  canTransition,
  effectsOf,
  isEditable,
  isOpen,
  isRealised,
  type DeductionMoment,
  type TransitionContext,
} from './state-machine.js';

/**
 * Every legal and illegal edge of the graph in PRD Section 7 — F-AD-33.
 *
 * The machine is pure, so the table below is the complete specification of what an
 * order may do. Anything not in it is an error, and the last test proves that by
 * walking every pair of statuses.
 */

const ALL = Object.values(OrderStatus);

function context(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    from: OrderStatus.PENDING,
    to: OrderStatus.CONFIRMED,
    paymentMethod: PaymentMethod.COD,
    paymentStatus: PaymentStatus.UNPAID,
    deductionMoment: 'confirmed',
    stockDeducted: false,
    stockReserved: true,
    totalMinor: 500_000n,
    ...overrides,
  };
}

// --- the graph --------------------------------------------------------------

describe('the transition graph', () => {
  const legal: Array<[OrderStatus, OrderStatus]> = [
    [OrderStatus.PENDING, OrderStatus.CONFIRMED],
    [OrderStatus.PENDING, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED, OrderStatus.PACKED],
    [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.PACKED, OrderStatus.SHIPPED],
    [OrderStatus.PACKED, OrderStatus.CANCELLED],
    [OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
    [OrderStatus.SHIPPED, OrderStatus.FAILED],
    [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED],
    [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.FAILED],
    [OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED],
    [OrderStatus.FAILED, OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.FAILED, OrderStatus.RETURNED],
    [OrderStatus.FAILED, OrderStatus.CANCELLED],
    [OrderStatus.RETURN_REQUESTED, OrderStatus.RETURNED],
    [OrderStatus.RETURN_REQUESTED, OrderStatus.DELIVERED],
    [OrderStatus.RETURNED, OrderStatus.REFUNDED],
  ];

  it.each(legal)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('refuses every pair not in the table', () => {
    const allowed = new Set(legal.map(([from, to]) => `${from}->${to}`));
    const wrongly: string[] = [];

    for (const from of ALL) {
      for (const to of ALL) {
        if (canTransition(from, to) !== allowed.has(`${from}->${to}`)) {
          wrongly.push(`${from}->${to}`);
        }
      }
    }

    expect(wrongly).toEqual([]);
  });

  it('lets nothing leave a terminal status', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(allowedFrom(status)).toEqual([]);
    }
  });

  it('refuses to move an order to where it already is', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('throws with a message naming what is allowed instead', () => {
    expect(() => effectsOf(context({ from: OrderStatus.PENDING, to: OrderStatus.SHIPPED }))).toThrow(
      IllegalTransitionError,
    );

    try {
      effectsOf(context({ from: OrderStatus.PENDING, to: OrderStatus.SHIPPED }));
    } catch (error) {
      expect((error as Error).message).toContain('CONFIRMED');
    }
  });

  it('explains a terminal status differently from a wrong step', () => {
    try {
      effectsOf(context({ from: OrderStatus.CANCELLED, to: OrderStatus.CONFIRMED }));
    } catch (error) {
      expect((error as Error).message).toContain('cannot change any further');
    }
  });
});

// --- stock ------------------------------------------------------------------

describe('stock effects', () => {
  const moments: DeductionMoment[] = ['confirmed', 'packed', 'shipped', 'delivered'];
  const statusFor: Record<DeductionMoment, OrderStatus> = {
    confirmed: OrderStatus.CONFIRMED,
    packed: OrderStatus.PACKED,
    shipped: OrderStatus.SHIPPED,
    delivered: OrderStatus.DELIVERED,
  };
  const previous: Record<DeductionMoment, OrderStatus> = {
    confirmed: OrderStatus.PENDING,
    packed: OrderStatus.CONFIRMED,
    shipped: OrderStatus.PACKED,
    delivered: OrderStatus.OUT_FOR_DELIVERY,
  };

  it.each(moments)('deducts at the configured moment: %s', (moment) => {
    const effects = effectsOf(
      context({
        from: previous[moment],
        to: statusFor[moment],
        deductionMoment: moment,
      }),
    );
    expect(effects.stock).toBe('deduct');
  });

  it('does not deduct at a moment the shop did not choose', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.PENDING,
        to: OrderStatus.CONFIRMED,
        deductionMoment: 'shipped',
      }),
    );
    expect(effects.stock).toBe('none');
  });

  it('never deducts twice', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.CONFIRMED,
        to: OrderStatus.PACKED,
        deductionMoment: 'packed',
        stockDeducted: true,
      }),
    );
    expect(effects.stock).toBe('none');
  });

  it('releases the hold when a reserved order is cancelled', () => {
    const effects = effectsOf(
      context({ from: OrderStatus.PENDING, to: OrderStatus.CANCELLED, stockReserved: true }),
    );
    expect(effects.stock).toBe('release');
  });

  it('restocks when a deducted order is cancelled', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.PACKED,
        to: OrderStatus.CANCELLED,
        stockDeducted: true,
        stockReserved: false,
      }),
    );
    expect(effects.stock).toBe('restock');
  });

  it('does nothing when a cancelled order held no stock at all', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.PENDING,
        to: OrderStatus.CANCELLED,
        stockReserved: false,
        stockDeducted: false,
      }),
    );
    expect(effects.stock).toBe('none');
  });

  it('restocks resellable returns', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.RETURN_REQUESTED,
        to: OrderStatus.RETURNED,
        stockDeducted: true,
        stockReserved: false,
        restock: true,
      }),
    );
    expect(effects.stock).toBe('restock');
  });

  it('writes off a damaged return rather than putting it back on the shelf', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.RETURN_REQUESTED,
        to: OrderStatus.RETURNED,
        stockDeducted: true,
        restock: false,
      }),
    );
    expect(effects.stock).toBe('none');
  });

  it('moves no stock on a failed delivery: the parcel is with the courier', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.FAILED,
        stockDeducted: true,
      }),
    );
    expect(effects.stock).toBe('none');
  });

  it('moves no stock when a failed delivery goes out again', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.FAILED,
        to: OrderStatus.OUT_FOR_DELIVERY,
        stockDeducted: true,
      }),
    );
    expect(effects.stock).toBe('none');
  });
});

// --- payment ----------------------------------------------------------------

describe('payment status', () => {
  it('marks a COD order paid when the full amount is collected', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERED,
        cashCollectedMinor: 500_000n,
        totalMinor: 500_000n,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('marks it paid when the driver was handed more than the total', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERED,
        cashCollectedMinor: 600_000n,
        totalMinor: 500_000n,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('does not call a short payment paid', () => {
    // Calling this PAID would hide the shortfall from the cash reconciliation.
    const effects = effectsOf(
      context({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERED,
        cashCollectedMinor: 300_000n,
        totalMinor: 500_000n,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it('leaves the status alone when no cash figure was given', () => {
    const effects = effectsOf(
      context({ from: OrderStatus.OUT_FOR_DELIVERY, to: OrderStatus.DELIVERED }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.UNPAID);
  });

  it('does not touch payment for a card order marked delivered', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERED,
        paymentMethod: PaymentMethod.CARD,
        paymentStatus: PaymentStatus.PAID,
        cashCollectedMinor: 0n,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('marks a refunded order refunded', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.RETURNED,
        to: OrderStatus.REFUNDED,
        paymentStatus: PaymentStatus.PAID,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });

  it('leaves a paid order paid when it is cancelled: a refund is its own action', () => {
    const effects = effectsOf(
      context({
        from: OrderStatus.CONFIRMED,
        to: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.PAID,
      }),
    );
    expect(effects.paymentStatus).toBe(PaymentStatus.PAID);
  });
});

// --- side effects -----------------------------------------------------------

describe('side effects', () => {
  it('stamps the timestamp column for the statuses that have one', () => {
    expect(effectsOf(context({ to: OrderStatus.CONFIRMED })).timestampField).toBe('confirmedAt');
    expect(
      effectsOf(context({ from: OrderStatus.PACKED, to: OrderStatus.SHIPPED })).timestampField,
    ).toBe('shippedAt');
    expect(
      effectsOf(context({ from: OrderStatus.SHIPPED, to: OrderStatus.OUT_FOR_DELIVERY }))
        .timestampField,
    ).toBeNull();
  });

  it('names the notification event for each customer-visible step', () => {
    expect(effectsOf(context({ to: OrderStatus.CONFIRMED })).notification).toBe('order.confirmed');
    expect(
      effectsOf(context({ from: OrderStatus.OUT_FOR_DELIVERY, to: OrderStatus.DELIVERED }))
        .notification,
    ).toBe('order.delivered');
  });

  it('sends nothing for an internal step the customer never sees', () => {
    expect(
      effectsOf(context({ from: OrderStatus.CONFIRMED, to: OrderStatus.PACKED })).notification,
    ).toBeNull();
  });

  it('gives the promo code back on a cancellation or a return', () => {
    expect(effectsOf(context({ to: OrderStatus.CANCELLED })).releasePromoUsage).toBe(true);
    expect(
      effectsOf(
        context({ from: OrderStatus.RETURN_REQUESTED, to: OrderStatus.RETURNED }),
      ).releasePromoUsage,
    ).toBe(true);
  });

  it('keeps the promo usage on a delivery', () => {
    expect(
      effectsOf(context({ from: OrderStatus.OUT_FOR_DELIVERY, to: OrderStatus.DELIVERED }))
        .releasePromoUsage,
    ).toBe(false);
  });

  it('recomputes the customer rollups on every outcome that changes them', () => {
    for (const to of [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED]) {
      const from =
        to === OrderStatus.CANCELLED ? OrderStatus.PENDING : OrderStatus.OUT_FOR_DELIVERY;
      expect(effectsOf(context({ from, to })).refreshCustomerStats).toBe(true);
    }
    expect(effectsOf(context({ to: OrderStatus.CONFIRMED })).refreshCustomerStats).toBe(false);
  });
});

// --- predicates -------------------------------------------------------------

describe('predicates', () => {
  it('allows editing only before the parcel is physical', () => {
    expect(isEditable(OrderStatus.PENDING)).toBe(true);
    expect(isEditable(OrderStatus.CONFIRMED)).toBe(true);
    expect(isEditable(OrderStatus.PACKED)).toBe(false);
    expect(isEditable(OrderStatus.SHIPPED)).toBe(false);
  });

  it('calls an order open until it is settled one way or the other', () => {
    expect(isOpen(OrderStatus.PENDING)).toBe(true);
    expect(isOpen(OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
    expect(isOpen(OrderStatus.FAILED)).toBe(true);
    expect(isOpen(OrderStatus.DELIVERED)).toBe(false);
    expect(isOpen(OrderStatus.CANCELLED)).toBe(false);
  });

  it('counts only a delivery as realised revenue', () => {
    expect(isRealised(OrderStatus.DELIVERED)).toBe(true);
    for (const status of ALL.filter((value) => value !== OrderStatus.DELIVERED)) {
      expect(isRealised(status)).toBe(false);
    }
  });
});
