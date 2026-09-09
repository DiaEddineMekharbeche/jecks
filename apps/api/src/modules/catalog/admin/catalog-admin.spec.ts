import { describe, expect, it, vi } from 'vitest';
import { nextAmount } from './products.service.js';
import { __variantInternals, cartesian, signature, skuPart } from './variants.service.js';
import { pathFor } from './categories.service.js';
import { __importInternals, parseAmount, readCsv } from './product-import.service.js';
import { RollupsService, availableStock } from './rollups.service.js';

describe('bulk price changes', () => {
  it('sets an amount outright', () => {
    expect(nextAmount(290_000n, { mode: 'set', amountMinor: 350_000n, target: 'price' })).toBe(
      350_000n,
    );
  });

  it('adds a flat amount', () => {
    expect(nextAmount(290_000n, { mode: 'increase', amountMinor: 10_000n, target: 'price' })).toBe(
      300_000n,
    );
  });

  it('raises by a percentage, rounding to the centime', () => {
    // 1 999,00 DA + 10 % = 2 198,90 DA
    expect(nextAmount(199_900n, { mode: 'increase', percent: 10, target: 'price' })).toBe(219_890n);
  });

  it('handles a fractional percentage without floating point', () => {
    expect(nextAmount(199_900n, { mode: 'increase', percent: 7.5, target: 'price' })).toBe(
      214_893n,
    );
  });

  it('never lets a reduction go below zero', () => {
    expect(nextAmount(5_000n, { mode: 'decrease', amountMinor: 900_000n, target: 'price' })).toBe(
      0n,
    );
  });

  it('applies a percentage cut symmetrically', () => {
    expect(nextAmount(200_000n, { mode: 'decrease', percent: 25, target: 'price' })).toBe(150_000n);
  });
});

describe('variant matrix', () => {
  it('produces every combination in option order', () => {
    expect(
      cartesian([
        ['noir', 'blanc'],
        ['s', 'm', 'l'],
      ]),
    ).toEqual([
      ['noir', 's'],
      ['noir', 'm'],
      ['noir', 'l'],
      ['blanc', 's'],
      ['blanc', 'm'],
      ['blanc', 'l'],
    ]);
  });

  it('gives a single option one variant per value', () => {
    expect(cartesian([['unique']])).toEqual([['unique']]);
  });

  it('matches an existing variant regardless of link order', () => {
    expect(signature(['a', 'b'])).toBe(signature(['b', 'a']));
    expect(signature(['a', 'b'])).not.toBe(signature(['a', 'c']));
  });

  it('folds an option value into a SKU fragment', () => {
    expect(skuPart('Noir')).toBe('NOIR');
    expect(skuPart('Taille unique')).toBe('TAILLEUN');
    expect(skuPart('Bleu marine')).toBe('BLEUMARI');
  });

  it('falls back rather than producing an empty fragment', () => {
    expect(skuPart('—')).toBe('X');
  });

  it('recognises a colour option in French and English', () => {
    expect(__variantInternals.kindOf('Couleur')).toBe('color');
    expect(__variantInternals.kindOf('Color')).toBe('color');
    expect(__variantInternals.kindOf('Taille')).toBe('size');
    expect(__variantInternals.kindOf('Matière')).toBe('text');
  });
});

describe('category paths', () => {
  it('builds a root path', () => {
    expect(pathFor(null, 'casquettes')).toBe('/casquettes/');
  });

  it('nests under its parent', () => {
    expect(pathFor({ path: '/casquettes/' }, 'truckers')).toBe('/casquettes/truckers/');
  });

  it('lets a cycle be detected by prefix', () => {
    const parent = pathFor(null, 'casquettes');
    const child = pathFor({ path: parent }, 'truckers');
    expect(child.startsWith(parent)).toBe(true);
    expect(parent.startsWith(child)).toBe(false);
  });
});

describe('import parsing', () => {
  it('reads dinars with either decimal separator', () => {
    expect(parseAmount('2900')).toBe(290_000n);
    expect(parseAmount('2900.50')).toBe(290_050n);
    expect(parseAmount('2900,50')).toBe(290_050n);
    expect(parseAmount('2 900')).toBe(290_000n);
  });

  it('pads a single decimal to centimes', () => {
    expect(parseAmount('2900.5')).toBe(290_050n);
  });

  it('refuses anything that is not a plain amount', () => {
    expect(parseAmount('2900 DA')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('2900.505')).toBeNull();
  });

  it('parses quoted CSV fields containing commas', () => {
    const rows = readCsv('sku,name_fr\nA-1,"Casquette noire, coton"\n');
    expect(rows).toEqual([
      ['sku', 'name_fr'],
      ['A-1', 'Casquette noire, coton'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    const rows = readCsv('name_fr\n"Le ""trucker"" classique"\n');
    expect(rows[1]).toEqual(['Le "trucker" classique']);
  });

  it('drops the byte-order mark Excel writes', () => {
    const rows = readCsv('﻿sku,price\nA-1,2900\n');
    expect(rows[0]?.[0]).toBe('sku');
  });

  it('accepts a semicolon-separated export as well', () => {
    expect(readCsv('sku;price\nA-1;2900')).toEqual([
      ['sku', 'price'],
      ['A-1', '2900'],
    ]);
  });

  it('splits a tag column on commas, semicolons or pipes', () => {
    expect(__importInternals.splitTags('nouveaute, coton;ete|noir')).toEqual([
      'nouveaute',
      'coton',
      'ete',
      'noir',
    ]);
  });
});

describe('stock rollup', () => {
  it('sums what is available across locations', () => {
    expect(
      availableStock([
        { onHand: 10, reserved: 2 },
        { onHand: 5, reserved: 0 },
      ]),
    ).toBe(13);
  });

  it('clamps an oversold location at zero instead of eating other stock', () => {
    expect(
      availableStock([
        { onHand: 1, reserved: 4 },
        { onHand: 9, reserved: 0 },
      ]),
    ).toBe(9);
  });

  it('is zero for a product with no levels', () => {
    expect(availableStock([])).toBe(0);
  });
});

describe('RollupsService', () => {
  function fakePrisma(overrides: Record<string, unknown> = {}) {
    return {
      variant: {
        aggregate: vi.fn().mockResolvedValue({
          _min: { price: 290_000n },
          _max: { price: 350_000n, compareAtPrice: 420_000n },
        }),
      },
      inventoryLevel: {
        findMany: vi.fn().mockResolvedValue([{ onHand: 12, reserved: 2 }]),
      },
      review: {
        aggregate: vi.fn().mockResolvedValue({ _avg: { rating: 4.3333 }, _count: { _all: 3 } }),
      },
      product: { update: vi.fn().mockResolvedValue({}) },
      ...overrides,
    };
  }

  it('writes the price range and available stock back onto the product', async () => {
    const prisma = fakePrisma();
    const service = new RollupsService(prisma as never);

    await service.refreshProduct('p1');

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        minPrice: 290_000n,
        maxPrice: 350_000n,
        maxCompareAt: 420_000n,
        totalStock: 10,
      },
    });
  });

  it('clears the compare-at price when no variant carries one', async () => {
    const prisma = fakePrisma({
      variant: {
        aggregate: vi.fn().mockResolvedValue({
          _min: { price: 290_000n },
          _max: { price: 290_000n, compareAtPrice: null },
        }),
      },
    });
    const service = new RollupsService(prisma as never);

    await service.refreshProduct('p1');

    // A stale compare-at keeps a "sale" badge on a full-price product for ever.
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maxCompareAt: null }) }),
    );
  });

  it('zeroes the range for a product whose variants are all inactive', async () => {
    const prisma = fakePrisma({
      variant: {
        aggregate: vi.fn().mockResolvedValue({
          _min: { price: null },
          _max: { price: null, compareAtPrice: null },
        }),
      },
      inventoryLevel: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const service = new RollupsService(prisma as never);

    await service.refreshProduct('p1');

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { minPrice: 0n, maxPrice: 0n, maxCompareAt: null, totalStock: 0 },
    });
  });

  it('averages only approved reviews, to two decimals', async () => {
    const prisma = fakePrisma();
    const service = new RollupsService(prisma as never);

    await service.refreshRating('p1');

    expect(prisma.review.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId: 'p1', status: 'APPROVED' } }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { ratingAverage: 4.33, ratingCount: 3 },
    });
  });

  it('resets the rating when the last approved review is gone', async () => {
    const prisma = fakePrisma({
      review: {
        aggregate: vi.fn().mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } }),
      },
    });
    const service = new RollupsService(prisma as never);

    await service.refreshRating('p1');

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { ratingAverage: 0, ratingCount: 0 },
    });
  });

  it('refreshes each product once even when an id repeats', async () => {
    const prisma = fakePrisma();
    const service = new RollupsService(prisma as never);

    await service.refreshProducts(['p1', 'p2', 'p1']);

    expect(prisma.product.update).toHaveBeenCalledTimes(2);
  });
});
