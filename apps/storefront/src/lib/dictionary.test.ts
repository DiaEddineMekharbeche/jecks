import { LOCALES } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import { DICTIONARY, fill, fillCount, formatEta, getDictionary, orderStatusLabel } from './dictionary';

/**
 * The dictionary contract — PRD Section 6.4.
 *
 * French is the reference. Every other locale must carry exactly the same key paths,
 * because a missing key does not fail a build: it renders `undefined` in the middle of
 * a shop, in the language of the shoppers least able to report it.
 */

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('dictionary completeness', () => {
  const reference = paths(DICTIONARY.fr).sort();

  it('covers every configured locale', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARY)).toContain(locale);
    }
  });

  it.each(LOCALES.filter((locale) => locale !== 'fr'))(
    '%s has exactly the French key set',
    (locale) => {
      const actual = paths(DICTIONARY[locale as 'ar' | 'en']).sort();

      const missing = reference.filter((key) => !actual.includes(key));
      const extra = actual.filter((key) => !reference.includes(key));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );

  it.each(LOCALES)('%s has no empty string anywhere', (locale) => {
    const empties: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (typeof value === 'string') {
        if (value.trim() === '') empties.push(prefix);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
      }
    };
    walk(DICTIONARY[locale as keyof typeof DICTIONARY], '');
    expect(empties).toEqual([]);
  });

  it('keeps the same placeholders in every translation of a string', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    const mismatches: string[] = [];
    const walk = (french: unknown, other: unknown, prefix: string) => {
      if (typeof french === 'string' && typeof other === 'string') {
        if (placeholders(french).join(',') !== placeholders(other).join(',')) {
          mismatches.push(prefix);
        }
        return;
      }
      if (typeof french === 'object' && french !== null && typeof other === 'object' && other !== null) {
        for (const [key, child] of Object.entries(french)) {
          walk(child, (other as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key);
        }
      }
    };

    for (const locale of ['ar', 'en'] as const) {
      walk(DICTIONARY.fr, DICTIONARY[locale], '');
    }

    expect(mismatches).toEqual([]);
  });
});

describe('getDictionary', () => {
  it('returns the requested locale', () => {
    expect(getDictionary('ar').nav.cart).toBe(DICTIONARY.ar.nav.cart);
  });

  it('falls back to French for anything unknown', () => {
    expect(getDictionary('de' as never).nav.cart).toBe(DICTIONARY.fr.nav.cart);
  });
});

describe('fill', () => {
  it('substitutes named placeholders', () => {
    expect(fill('Plus que {amount} pour la livraison offerte', { amount: '500 DA' })).toBe(
      'Plus que 500 DA pour la livraison offerte',
    );
  });

  it('leaves an unknown placeholder in place rather than blanking it', () => {
    expect(fill('Bonjour {name}', {})).toBe('Bonjour {name}');
  });

  it('replaces every occurrence', () => {
    expect(fill('{a} et {a}', { a: 'x' })).toBe('x et x');
  });
});

describe('fillCount', () => {
  it('uses the singular for exactly one', () => {
    expect(fillCount('{count} articles', '1 article', 1)).toBe('1 article');
  });

  it('uses the plural otherwise', () => {
    expect(fillCount('{count} articles', '1 article', 3)).toBe('3 articles');
    expect(fillCount('{count} articles', '1 article', 0)).toBe('0 articles');
  });
});

describe('formatEta', () => {
  const dictionary = getDictionary('fr');

  it('collapses an identical range to a single day', () => {
    expect(formatEta(dictionary, 2, 2)).toBe('2 jour');
  });

  it('shows a range when the two differ', () => {
    expect(formatEta(dictionary, 2, 4)).toBe('2 à 4 jours');
  });
});

describe('orderStatusLabel', () => {
  const dictionary = getDictionary('fr');

  it('translates every status the API can send', () => {
    for (const status of Object.keys(DICTIONARY.fr.orderStatus)) {
      expect(orderStatusLabel(dictionary, status)).not.toBe(status);
    }
  });

  it('falls back to the raw value for anything unrecognised', () => {
    expect(orderStatusLabel(dictionary, 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
