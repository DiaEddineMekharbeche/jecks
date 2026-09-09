/** Shared helpers for the seed modules. Deterministic: same input, same database. */

export function tr(fr: string, ar?: string, en?: string): Record<string, string> {
  const out: Record<string, string> = { fr };
  if (ar) out.ar = ar;
  out.en = en ?? fr;
  return out;
}

/** ASCII, accent-free key used for the unique (wilayaCode, nameAscii) index. */
export function ascii(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(input: string): string {
  return ascii(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/**
 * Seeded pseudo-random generator (mulberry32). Demo data must be reproducible so a
 * dashboard screenshot from one machine matches another.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with an empty list');
  return items[Math.floor(rng() * items.length)] as T;
}

export function pickMany<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  }
  return out;
}

export function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function daysAgo(days: number, hour = 12): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

export function startOfDayUtc(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Order numbers follow the JK-{YYMMDD}-{SEQ} format of PRD F-AD-91. */
export function orderNumber(date: Date, sequence: number): string {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `JK-${yy}${mm}${dd}-${String(sequence).padStart(4, '0')}`;
}

/** DZD prices are quoted in whole hundreds; this keeps demo prices believable. */
export function dzd(major: number): bigint {
  return BigInt(Math.round(major * 100));
}

export function log(step: string, detail?: string | number): void {
  const suffix = detail === undefined ? '' : ` ${detail}`;
  process.stdout.write(`  ${step}${suffix}\n`);
}
