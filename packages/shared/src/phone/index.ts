/**
 * Phone numbers — PRD Section 3: the phone number is the primary customer identifier,
 * so it must normalize to one canonical E.164 string no matter how the shopper types it.
 *
 * Algerian numbering plan:
 *   mobile   0[5-7]X XX XX XX XX  (10 national digits, 9 after the trunk zero)
 *   landline 0[2-4]X XX XX XX     (9 national digits, 8 after the trunk zero)
 * Country code 213. Mobile prefixes map to carriers: 5 Ooredoo, 6 Mobilis, 7 Djezzy.
 */

/** Significant-digit count per leading digit, once the trunk zero is stripped. */
const MOBILE_LENGTH = 9;
const LANDLINE_LENGTH = 8;

export const DZ_COUNTRY_CODE = '213';

export type DzCarrier = 'ooredoo' | 'mobilis' | 'djezzy' | 'unknown';

export interface ParsedPhone {
  /** Canonical storage form, e.g. `+213551234567`. */
  readonly e164: string;
  /** National form shown in the admin and on labels, e.g. `0551 23 45 67`. */
  readonly national: string;
  readonly countryCode: string;
  readonly isMobile: boolean;
  readonly carrier: DzCarrier;
}

export class InvalidPhoneError extends Error {
  constructor(input: string, readonly reason: string) {
    super(`Invalid phone number "${input}": ${reason}`);
    this.name = 'InvalidPhoneError';
  }
}

/** Strip spaces, dots, dashes, parentheses and a leading 00 international prefix. */
function clean(input: string): string {
  const trimmed = input.trim().replace(/[\s.\-()/]/g, '');
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  return trimmed;
}

/**
 * Reduce any Algerian input to the 9 significant national digits, or null when the
 * input is not an Algerian number.
 */
function significantDigits(input: string): string | null {
  const value = clean(input);
  if (!/^\+?\d+$/.test(value)) return null;
  const digits = value.replace(/^\+/, '');

  if (digits.startsWith(DZ_COUNTRY_CODE)) {
    const rest = digits.slice(DZ_COUNTRY_CODE.length).replace(/^0/, '');
    return rest;
  }
  if (digits.startsWith('0')) return digits.slice(1);
  // Bare significant digits, e.g. "551234567" pasted without the trunk zero.
  if (digits.length === MOBILE_LENGTH && /^[5-7]/.test(digits)) return digits;
  if (digits.length === LANDLINE_LENGTH && /^[2-4]/.test(digits)) return digits;
  return null;
}

export function isValidDzPhone(input: string): boolean {
  return parseDzPhoneOrNull(input) !== null;
}

export function parseDzPhoneOrNull(input: string): ParsedPhone | null {
  try {
    return parseDzPhone(input);
  } catch {
    return null;
  }
}

export function parseDzPhone(input: string): ParsedPhone {
  if (!input) throw new InvalidPhoneError(input, 'empty');
  const significant = significantDigits(input);
  if (significant === null) throw new InvalidPhoneError(input, 'not an Algerian number');
  const lead = significant[0] ?? '';
  if (!/[2-7]/.test(lead)) {
    throw new InvalidPhoneError(input, `unknown prefix 0${lead}`);
  }
  const isMobile = /[5-7]/.test(lead);
  const expected = isMobile ? MOBILE_LENGTH : LANDLINE_LENGTH;
  if (significant.length !== expected) {
    throw new InvalidPhoneError(
      input,
      `expected ${expected} significant digits, got ${significant.length}`,
    );
  }
  return {
    e164: `+${DZ_COUNTRY_CODE}${significant}`,
    national: formatNational(significant, isMobile),
    countryCode: DZ_COUNTRY_CODE,
    isMobile,
    carrier: carrierOf(lead, isMobile),
  };
}

/**
 * Canonical form for the `customers.phone` unique column and every lookup.
 * Throws rather than storing a number that cannot be dialled by a driver.
 */
export function normalizeDzPhone(input: string): string {
  return parseDzPhone(input).e164;
}

function carrierOf(lead: string, isMobile: boolean): DzCarrier {
  if (!isMobile) return 'unknown';
  if (lead === '5') return 'ooredoo';
  if (lead === '6') return 'mobilis';
  if (lead === '7') return 'djezzy';
  return 'unknown';
}

function formatNational(significant: string, isMobile: boolean): string {
  const national = `0${significant}`;
  // 0551 23 45 67 for mobile, 021 23 45 67 for landline.
  return isMobile
    ? `${national.slice(0, 4)} ${national.slice(4, 6)} ${national.slice(6, 8)} ${national.slice(8)}`
    : `${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7)}`;
}

/** `wa.me` deep link for the WhatsApp fallback of Section 10.9. */
export function whatsappLink(input: string, message?: string): string {
  const digits = normalizeDzPhone(input).replace('+', '');
  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${query}`;
}

export function telLink(input: string): string {
  return `tel:${normalizeDzPhone(input)}`;
}

/** Partially hide a number for public-facing surfaces (order tracking, reviews). */
export function maskPhone(input: string): string {
  const parsed = parseDzPhoneOrNull(input);
  if (!parsed) return '•••';
  const digits = parsed.e164.slice(1 + DZ_COUNTRY_CODE.length);
  const hidden = '•'.repeat(Math.max(digits.length - 4, 1));
  return `+${DZ_COUNTRY_CODE} ${digits.slice(0, 2)}${hidden}${digits.slice(-2)}`;
}
