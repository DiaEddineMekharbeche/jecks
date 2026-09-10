import { OrderStatus, PaymentMethod, PaymentStatus } from '@jecks/shared';

/**
 * The order state machine — PRD Section 7 and F-AD-33.
 *
 * Pure. It answers two questions and nothing else: may this order move from here to
 * there, and what must happen to stock and payment when it does. The service that owns
 * the transaction does the moving.
 *
 * Keeping it pure is what makes "every legal and illegal edge" a table rather than a
 * discussion, and it is why the stock effects can be reasoned about without opening a
 * database: the same transition always produces the same intent.
 */

/** The graph of PRD Section 7, written once. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  [OrderStatus.PACKED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  // Own-fleet orders go straight out for delivery; a courier's go through SHIPPED.
  [OrderStatus.SHIPPED]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderStatus.FAILED],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURN_REQUESTED],
  // A failed delivery is retried, or the parcel comes back.
  [OrderStatus.FAILED]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RETURNED, OrderStatus.CANCELLED],
  [OrderStatus.RETURN_REQUESTED]: [OrderStatus.RETURNED, OrderStatus.DELIVERED],
  [OrderStatus.RETURNED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

/** Statuses from which nothing further can happen. */
export const TERMINAL_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

/** DECISIONS D20 — when the shop considers the goods to have left the shelf. */
export type DeductionMoment = 'confirmed' | 'packed' | 'shipped' | 'delivered';

export interface TransitionContext {
  from: OrderStatus;
  to: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deductionMoment: DeductionMoment;
  /** True once stock has been physically removed for this order. */
  stockDeducted: boolean;
  /** True while the order still holds a reservation against available stock. */
  stockReserved: boolean;
  /** Cash the driver or courier handed in, minor units. Only meaningful at DELIVERED. */
  cashCollectedMinor?: bigint;
  totalMinor: bigint;
  /** Set on a return: resellable goods go back on the shelf, damaged ones do not. */
  restock?: boolean;
}

export type StockEffect =
  /** Hold units against available stock without moving them. */
  | 'reserve'
  /** Give the hold back. */
  | 'release'
  /** Physically remove the units and release the hold that covered them. */
  | 'deduct'
  /** Put units back on the shelf. */
  | 'restock'
  | 'none';

export interface TransitionEffects {
  stock: StockEffect;
  paymentStatus: PaymentStatus;
  /** Timestamp column to stamp, when the status has one. */
  timestampField: string | null;
  /** Event key the notification queue dispatches on. */
  notification: string | null;
  /** True when the order's promo usages should be given back. */
  releasePromoUsage: boolean;
  /** True when the customer's lifetime rollups should be recomputed. */
  refreshCustomerStats: boolean;
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';

  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(
      TERMINAL_STATUSES.includes(from)
        ? `A ${from.toLowerCase()} order cannot change any further`
        : `An order cannot go from ${from} to ${to}. Allowed: ${allowedFrom(from).join(', ') || 'nothing'}`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export function allowedFrom(status: OrderStatus): OrderStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return allowedFrom(from).includes(to);
}

/**
 * What a transition means for stock, payment and the rest.
 *
 * Throws on an illegal move rather than returning a null effect: a caller that forgets
 * to check would otherwise write the new status with no side effects at all, which is
 * the worst of both outcomes.
 */
export function effectsOf(context: TransitionContext): TransitionEffects {
  if (!canTransition(context.from, context.to)) {
    throw new IllegalTransitionError(context.from, context.to);
  }

  return {
    stock: stockEffect(context),
    paymentStatus: paymentStatusAfter(context),
    timestampField: TIMESTAMP_FIELDS[context.to] ?? null,
    notification: NOTIFICATION_EVENTS[context.to] ?? null,
    // Cancelling or returning frees the code for its next use; a shopper whose order
    // never shipped has not spent their one-per-customer offer.
    releasePromoUsage:
      context.to === OrderStatus.CANCELLED || context.to === OrderStatus.RETURNED,
    refreshCustomerStats: (
      [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
        OrderStatus.FAILED,
        OrderStatus.RETURNED,
        OrderStatus.REFUNDED,
      ] as OrderStatus[]
    ).includes(context.to),
  };
}

/**
 * Whether stock moves, and how.
 *
 * The whole subtlety is that "reserved" and "deducted" are different states and an
 * order is in exactly one of them. Deducting must release the reservation that covered
 * it, or the same units are counted against availability twice.
 */
function stockEffect(context: TransitionContext): StockEffect {
  const { to, deductionMoment, stockDeducted, stockReserved } = context;

  if (to === OrderStatus.CANCELLED) {
    if (stockDeducted) return 'restock';
    return stockReserved ? 'release' : 'none';
  }

  if (to === OrderStatus.RETURNED) {
    // Damaged goods are written off rather than resold; the ledger still records the
    // movement, but through an adjustment the operator makes deliberately.
    if (context.restock === false) return 'none';
    return stockDeducted ? 'restock' : stockReserved ? 'release' : 'none';
  }

  // A delivery that failed has not returned the goods: the parcel is with the courier
  // and either goes out again or comes back. Nothing moves here.
  if (to === OrderStatus.FAILED) return 'none';

  if (stockDeducted) return 'none';

  const deductsHere =
    (deductionMoment === 'confirmed' && to === OrderStatus.CONFIRMED) ||
    (deductionMoment === 'packed' && to === OrderStatus.PACKED) ||
    (deductionMoment === 'shipped' && to === OrderStatus.SHIPPED) ||
    (deductionMoment === 'delivered' && to === OrderStatus.DELIVERED);

  return deductsHere ? 'deduct' : 'none';
}

/**
 * Payment status moves independently of fulfilment — PRD Section 7.
 *
 * The one coupling is cash on delivery: a COD order becomes paid when the money is
 * actually handed over, and partially paid when the customer paid less than the total,
 * which happens when a driver accepts a short payment on the doorstep.
 */
function paymentStatusAfter(context: TransitionContext): PaymentStatus {
  const { to, paymentMethod, paymentStatus, cashCollectedMinor, totalMinor } = context;

  if (to === OrderStatus.DELIVERED && paymentMethod === PaymentMethod.COD) {
    if (cashCollectedMinor === undefined) return paymentStatus;
    if (cashCollectedMinor >= totalMinor) return PaymentStatus.PAID;
    // Less than the total but more than nothing: the shop is owed the difference, and
    // calling that PAID would hide it from the cash reconciliation.
    return cashCollectedMinor > 0n ? PaymentStatus.PARTIALLY_REFUNDED : paymentStatus;
  }

  if (to === OrderStatus.REFUNDED) return PaymentStatus.REFUNDED;

  // An unpaid order that is cancelled or returned stays unpaid; a paid one keeps its
  // status until a refund is actually issued, which is a separate action with its own
  // money movement.
  return paymentStatus;
}

const TIMESTAMP_FIELDS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.CONFIRMED]: 'confirmedAt',
  [OrderStatus.PACKED]: 'packedAt',
  [OrderStatus.SHIPPED]: 'shippedAt',
  [OrderStatus.DELIVERED]: 'deliveredAt',
  [OrderStatus.CANCELLED]: 'cancelledAt',
  [OrderStatus.RETURNED]: 'returnedAt',
};

const NOTIFICATION_EVENTS: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.CONFIRMED]: 'order.confirmed',
  [OrderStatus.SHIPPED]: 'order.shipped',
  [OrderStatus.OUT_FOR_DELIVERY]: 'order.out_for_delivery',
  [OrderStatus.DELIVERED]: 'order.delivered',
  [OrderStatus.FAILED]: 'order.failed',
  [OrderStatus.CANCELLED]: 'order.cancelled',
};

/**
 * Statuses an order may still be edited in — PRD F-AD-31.
 *
 * Once a parcel is packed its contents are physical; changing the order after that
 * describes a package that does not exist.
 */
export function isEditable(status: OrderStatus): boolean {
  return status === OrderStatus.PENDING || status === OrderStatus.CONFIRMED;
}

/** Whether an order in this status is still expected to produce revenue. */
export function isOpen(status: OrderStatus): boolean {
  return !(
    [
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.REFUNDED,
    ] as OrderStatus[]
  ).includes(status);
}

/** Statuses that count as a completed sale for the P&L and customer rollups. */
export function isRealised(status: OrderStatus): boolean {
  return status === OrderStatus.DELIVERED;
}
