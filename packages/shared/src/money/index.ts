/**
 * Money — PRD Section 8: every monetary value is an integer of minor units
 * (centimes for DZD) plus an ISO-4217 code. No float ever touches a price.
 */

export type CurrencyCode = 'DZD' | 'EUR' | 'USD';

export interface Money {
  readonly amount: bigint;
  readonly currency: CurrencyCode;
}

interface CurrencyMeta {
  readonly decimals: number;
  /** Symbol shown to shoppers. Algeria writes "DA" after the number. */
  readonly symbol: string;
  readonly symbolPosition: 'before' | 'after';
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  DZD: { decimals: 2, symbol: 'DA', symbolPosition: 'after' },
  EUR: { decimals: 2, symbol: '€', symbolPosition: 'before' },
  USD: { decimals: 2, symbol: '$', symbolPosition: 'before' },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'DZD';

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} with ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function money(
  amount: bigint | number | string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Money {
  return { amount: toBigInt(amount), currency };
}

export function zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return { amount: 0n, currency };
}

/** Build Money from a major-unit value ("1250.50" DA -> 125050 centimes). */
export function fromMajor(
  value: number | string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): Money {
  const meta = CURRENCIES[currency];
  const text = typeof value === 'number' ? value.toFixed(meta.decimals) : value.trim();
  const negative = text.startsWith('-');
  const [whole = '0', frac = ''] = text.replace(/^[+-]/, '').split('.');
  const padded = (frac + '0'.repeat(meta.decimals)).slice(0, meta.decimals);
  const carry = frac.length > meta.decimals && Number(frac[meta.decimals]) >= 5 ? 1n : 0n;
  const amount = BigInt(whole) * 10n ** BigInt(meta.decimals) + BigInt(padded || '0') + carry;
  return { amount: negative ? -amount : amount, currency };
}

/** Major-unit number, for charts and CSV exports only — never for arithmetic. */
export function toMajorNumber(m: Money): number {
  return Number(m.amount) / 10 ** CURRENCIES[m.currency].decimals;
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSame(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function sum(items: readonly Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

export function multiply(m: Money, factor: number | bigint): Money {
  if (typeof factor === 'bigint') return { amount: m.amount * factor, currency: m.currency };
  return { amount: scaleHalfUp(m.amount, factor), currency: m.currency };
}

export function negate(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}

export function isZero(m: Money): boolean {
  return m.amount === 0n;
}

export function isNegative(m: Money): boolean {
  return m.amount < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSame(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** Never let a computed price fall below zero (discounts larger than the line total). */
export function clampToZero(m: Money): Money {
  return m.amount < 0n ? zero(m.currency) : m;
}

/**
 * Percentage of an amount, rounded half-up. `percent` is a human percentage:
 * `percentOf(money(10000n), 30)` is a 30 % discount = 3000.
 */
export function percentOf(m: Money, percent: number): Money {
  return { amount: scaleHalfUp(m.amount, percent / 100), currency: m.currency };
}

/**
 * Split an amount across weighted parts with no lost centime. The remainder is spread
 * one centime at a time over the leading parts, so the pieces always re-sum exactly.
 * Used to push an order-level discount down onto order lines for per-product margin.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || total <= 0) {
    throw new Error('allocate() requires at least one positive weight');
  }
  const out: bigint[] = [];
  let assigned = 0n;
  for (const weight of weights) {
    const share = scaleHalfUp(m.amount, weight / total);
    out.push(share);
    assigned += share;
  }
  let remainder = m.amount - assigned;
  const step = remainder < 0n ? -1n : 1n;
  for (let i = 0; remainder !== 0n; i = (i + 1) % out.length) {
    out[i] = (out[i] as bigint) + step;
    remainder -= step;
  }
  return out.map((amount) => ({ amount, currency: m.currency }));
}

/** Margin as a percentage of the selling price. Null when the price is zero. */
export function marginPercent(price: Money, cost: Money): number | null {
  assertSame(price, cost);
  if (price.amount === 0n) return null;
  const margin = Number(price.amount - cost.amount) / Number(price.amount);
  return Math.round(margin * 1000) / 10;
}

/** Discount percentage between a compare-at price and the effective price. */
export function discountPercent(compareAt: Money, price: Money): number {
  assertSame(compareAt, price);
  if (compareAt.amount <= price.amount || compareAt.amount === 0n) return 0;
  return Math.round((Number(compareAt.amount - price.amount) / Number(compareAt.amount)) * 100);
}

/**
 * Tax portion of a tax-inclusive price (PRD Section 3: prices include VAT,
 * the split exists for reporting only).
 */
export function taxIncluded(gross: Money, ratePercent: number): Money {
  const divisor = 1 + ratePercent / 100;
  const net = scaleHalfUp(gross.amount, 1 / divisor);
  return { amount: gross.amount - net, currency: gross.currency };
}

export function format(
  m: Money,
  opts: { locale?: string; withSymbol?: boolean; compact?: boolean } = {},
): string {
  const { locale = 'fr-DZ', withSymbol = true, compact = false } = opts;
  const meta = CURRENCIES[m.currency];
  const value = toMajorNumber(m);
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: compact ? 0 : meta.decimals,
    maximumFractionDigits: compact ? 0 : meta.decimals,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
  if (!withSymbol) return body;
  return meta.symbolPosition === 'after' ? `${body} ${meta.symbol}` : `${meta.symbol}${body}`;
}

// --- internals ---------------------------------------------------------------

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

function toBigInt(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return BigInt(value);
  if (!Number.isInteger(value)) {
    throw new TypeError(`money() needs an integer of minor units, received ${value}`);
  }
  return BigInt(value);
}

/** Multiply a bigint by a float and round half-up, away from zero on .5 ties. */
function scaleHalfUp(amount: bigint, factor: number): bigint {
  const PRECISION = 1_000_000n;
  const scaled = BigInt(Math.round(factor * Number(PRECISION)));
  const product = amount * scaled;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const quotient = abs / PRECISION;
  const remainder = abs % PRECISION;
  const rounded = remainder * 2n >= PRECISION ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
