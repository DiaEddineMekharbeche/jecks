import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { formatDa, message } from './errors';

/**
 * What an operator is shown when something goes wrong, and what money looks like.
 *
 * Both are read on every screen. A wrong message sends somebody to the wrong place, and
 * a wrong amount is worse than no amount.
 */

describe('message', () => {
  it('uses the API’s own words, which are already written for an operator', () => {
    const error = new ApiRequestError(422, 'VALIDATION_FAILED', 'Le code promo a expiré');

    expect(message(error, 'Échec')).toBe('Le code promo a expiré');
  });

  it('falls back for a network failure, where the browser says "Failed to fetch"', () => {
    expect(message(new TypeError('Failed to fetch'), 'Le serveur est injoignable')).toBe(
      'Failed to fetch',
    );
  });

  it('falls back for something that is not an error at all', () => {
    expect(message(undefined, 'Échec')).toBe('Échec');
    expect(message(null, 'Échec')).toBe('Échec');
    expect(message('a string', 'Échec')).toBe('Échec');
    expect(message({ weird: true }, 'Échec')).toBe('Échec');
  });

  it('falls back for an error with an empty message rather than showing nothing', () => {
    expect(message(new Error(''), 'Échec')).toBe('Échec');
  });
});

describe('ApiRequestError.fieldErrors', () => {
  it('keys the Zod detail by its dotted path, which is what a form field is named', () => {
    const error = new ApiRequestError(422, 'VALIDATION_FAILED', 'Champs à corriger', [
      { path: 'name.fr', message: 'Obligatoire' },
      { path: 'variants.0.sku', message: 'Déjà utilisé' },
    ]);

    expect(error.fieldErrors).toEqual({
      'name.fr': 'Obligatoire',
      'variants.0.sku': 'Déjà utilisé',
    });
  });

  it('is empty when the details are not a list, rather than throwing on a form', () => {
    expect(new ApiRequestError(400, 'X', 'y', { unknown: ['a'] }).fieldErrors).toEqual({});
    expect(new ApiRequestError(400, 'X', 'y').fieldErrors).toEqual({});
  });

  it('skips an entry missing its path or its message', () => {
    const error = new ApiRequestError(422, 'VALIDATION_FAILED', 'x', [
      { path: 'slug', message: 'Obligatoire' },
      { path: 'orphan' },
      { message: 'sans champ' },
    ]);

    expect(error.fieldErrors).toEqual({ slug: 'Obligatoire' });
  });
});

describe('formatDa', () => {
  it('reads minor units as dinars', () => {
    // 350 000 centimes is 3 500 DA, not 350 000.
    expect(formatDa(350_000)).toContain('3');
    expect(formatDa(350_000)).toContain('500');
    expect(formatDa(350_000)).toContain('DA');
  });

  it('takes the string the API sends for a BigInt column', () => {
    // Money arrives as a string because JSON has no 64-bit integer.
    expect(formatDa('350000')).toBe(formatDa(350_000));
  });

  it('takes a BigInt too', () => {
    expect(formatDa(350_000n)).toBe(formatDa(350_000));
  });

  it('shows a dash for nothing, rather than 0 DA', () => {
    // An order with no shipping cost recorded and one that ships free are different
    // facts, and a zero would state the second.
    expect(formatDa(null)).toBe('—');
    expect(formatDa(undefined)).toBe('—');
  });

  it('shows a real zero as zero', () => {
    expect(formatDa(0)).toContain('0');
    expect(formatDa(0)).not.toBe('—');
  });

  it('keeps the centimes when there are any', () => {
    expect(formatDa(350_050)).toContain('50');
  });

  it('handles a negative, which a refund line is', () => {
    expect(formatDa(-350_000)).toContain('-');
  });
});
