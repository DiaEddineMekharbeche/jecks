import { describe, expect, it } from 'vitest';
import { renderLabels, renderManifest, formatDa } from './delivery-documents.js';
import { A4, PdfDocument, code128b, escapeText, textWidth, wrap } from './pdf-document.js';

/**
 * The PDF writer is exercised through its output bytes.
 *
 * There is no reader here to render it, so the tests check the structural invariants a
 * reader depends on: a header, an xref whose offsets point at real objects, one page
 * object per page, and a trailer. A file that fails any of those opens as "damaged".
 */

const asText = (pdf: Buffer): string => pdf.toString('binary');

describe('PdfDocument', () => {
  it('writes a header, an xref and a trailer', () => {
    const pdf = new PdfDocument().addPage().text('Bonjour', 40, 40).build();
    const text = asText(pdf);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('produces a page even when none was added', () => {
    expect(asText(new PdfDocument().build())).toContain('/Type /Page');
  });

  it('counts one page object per page', () => {
    const pdf = new PdfDocument().addPage().addPage().addPage().build();
    const matches = asText(pdf).match(/\/Type \/Page[^s]/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(asText(pdf)).toContain('/Count 3');
  });

  it('points every xref offset at the object it claims', () => {
    const text = asText(new PdfDocument().addPage().text('x', 10, 10).build());
    // The table, not the "startxref" pointer in the trailer that follows it.
    const xrefStart = text.indexOf('\nxref\n');
    // Past 'xref', the '0 N' count line and the free entry for object zero.
    const rows = text.slice(xrefStart + 1).split('\n').slice(3);

    let object = 1;
    for (const row of rows) {
      const match = /^(\d{10}) 00000 n $/.exec(row);
      if (!match) break;
      const offset = Number(match[1]);
      expect(text.slice(offset)).toMatch(new RegExp(`^${object} 0 obj`));
      object += 1;
    }
    expect(object).toBeGreaterThan(4);
  });

  it('declares a content length that matches the stream it wrote', () => {
    const text = asText(new PdfDocument().addPage().text('Casquette', 20, 20).build());
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text);
    expect(match).not.toBeNull();
    expect(Buffer.byteLength(match![2]!, 'binary')).toBe(Number(match![1]));
  });

  it('flips the y axis so callers can measure from the top', () => {
    const text = asText(new PdfDocument(A4).addPage().text('x', 0, 0).build());
    // y=0 from the top is the page height in PDF coordinates.
    expect(text).toContain(`1 0 0 1 0 ${Math.round(A4.height * 100) / 100}`);
  });

  it('reports the page count and size it is working on', () => {
    const pdf = new PdfDocument(A4).addPage();
    expect(pdf.pageCount).toBe(1);
    expect(pdf.size.width).toBe(A4.width);
  });
});

describe('escapeText', () => {
  it('escapes the delimiters that would break a string object', () => {
    expect(escapeText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
  });

  it('writes an accent as its WinAnsi octal code', () => {
    // é is 0xE9, octal 351.
    expect(escapeText('é')).toBe('\\351');
  });

  it('transliterates a typographic apostrophe rather than dropping it', () => {
    expect(escapeText('l’adresse')).toBe("l'adresse");
  });

  it('replaces Arabic with a question mark, never a blank', () => {
    expect(escapeText('قسنطينة')).toBe('???????');
  });

  it('turns a control character into a space', () => {
    expect(escapeText('a\nb')).toBe('a b');
  });
});

describe('text measurement and wrapping', () => {
  it('measures a wider string as wider', () => {
    expect(textWidth('WWWW', 'Helvetica', 10)).toBeGreaterThan(textWidth('iiii', 'Helvetica', 10));
  });

  it('scales with the point size', () => {
    expect(textWidth('abc', 'Helvetica', 20)).toBeCloseTo(textWidth('abc', 'Helvetica', 10) * 2, 6);
  });

  it('makes bold wider than regular', () => {
    expect(textWidth('abc', 'Helvetica-Bold', 10)).toBeGreaterThan(textWidth('abc', 'Helvetica', 10));
  });

  it('wraps at word boundaries', () => {
    const lines = wrap('Cité 300 logements bâtiment C escalier 4', 'Helvetica', 9, 80);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 'Helvetica', 9)).toBeLessThanOrEqual(80.5);
  });

  it('breaks a word that cannot fit rather than overflowing', () => {
    const lines = wrap('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'Helvetica', 12, 40);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('returns a single empty line for empty text', () => {
    expect(wrap('', 'Helvetica', 10, 100)).toEqual(['']);
  });
});

describe('code128b', () => {
  it('starts with the Start-B pattern and ends with the stop pattern', () => {
    const widths = code128b('A');
    expect(widths.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(widths.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('encodes the documented example correctly', () => {
    // "PJJ123C" is the worked example in the Code 128 specification; its checksum is 54.
    const widths = code128b('PJJ123C');
    // Start + 7 data + checksum are six modules each, plus the 7-element stop.
    expect(widths).toHaveLength((1 + 7 + 1) * 6 + 7);
  });

  it('produces an odd number of elements, so it starts and ends on a bar', () => {
    expect(code128b('JK-260910-0042').length % 2).toBe(1);
  });

  it('substitutes a character it cannot encode instead of failing', () => {
    expect(() => code128b('café')).not.toThrow();
  });

  it('encodes an empty value as start, checksum and stop', () => {
    expect(code128b('')).toHaveLength(2 * 6 + 7);
  });
});

describe('formatDa', () => {
  it('groups thousands and drops empty centimes', () => {
    expect(formatDa(480_000n)).toBe('4 800 DA');
  });

  it('keeps centimes when there are any', () => {
    expect(formatDa(480_050n)).toBe('4 800,50 DA');
  });

  it('formats zero', () => {
    expect(formatDa(0n)).toBe('0 DA');
  });

  it('keeps a negative sign', () => {
    expect(formatDa(-35_000n)).toBe('-350 DA');
  });
});

describe('renderLabels', () => {
  const label = {
    orderNumber: 'JK-260910-0042',
    trackingNumber: 'YAL-99',
    shopName: "Jeck's",
    shopPhone: '+213551000000',
    customerName: 'Yacine Benali',
    customerPhone: '+213551234567',
    altPhone: null,
    address: 'Cité 300 logements',
    communeName: 'Bab Ezzouar',
    wilayaCode: 16,
    wilayaName: 'Alger',
    isStopDesk: false,
    pickupPointName: null,
    codAmountMinor: 480_000n,
    itemCount: 2,
    weightGrams: 1400,
    courierName: 'Yalidine',
    note: null,
    printedAt: new Date('2026-09-10T09:00:00Z'),
  };

  it('renders one page per parcel', () => {
    const text = asText(renderLabels([label, { ...label, orderNumber: 'JK-260910-0043' }]));
    expect(text).toContain('/Count 2');
  });

  it('prints the amount to collect', () => {
    expect(asText(renderLabels([label]))).toContain('4 800 DA');
  });

  it('says plainly when nothing is to be collected', () => {
    const text = asText(renderLabels([{ ...label, codAmountMinor: 0n }]));
    expect(text).toContain('NE RIEN ENCAISSER');
    // "À ENCAISSER" is written as an escaped À; its absence is the point.
    expect(text).not.toContain('\\300 ENCAISSER');
  });

  it('names the stop desk instead of an address for a desk parcel', () => {
    const text = asText(
      renderLabels([{ ...label, isStopDesk: true, pickupPointName: 'Agence Bab Ezzouar' }]),
    );
    expect(text).toContain('STOP DESK');
  });

  it('renders an empty batch as an empty document rather than throwing', () => {
    expect(asText(renderLabels([]))).toContain('%PDF-1.4');
  });
});

describe('renderManifest', () => {
  const manifest = {
    runCode: 'RUN-260910-1',
    date: new Date('2026-09-10T00:00:00Z'),
    driverName: 'Karim Haddad',
    driverPhone: '+213661112233',
    vehicleLabel: 'Kangoo 16-123-45',
    shopName: "Jeck's",
    stops: Array.from({ length: 3 }, (_, index) => ({
      position: index + 1,
      orderNumber: `JK-260910-00${index + 1}`,
      customerName: 'Client Test',
      customerPhone: '+213551234567',
      address: 'Rue Didouche Mourad',
      communeName: 'Alger Centre',
      wilayaName: 'Alger',
      itemCount: 1,
      codAmountMinor: 250_000n,
    })),
    expectedCashMinor: 750_000n,
    distanceKm: 12.4,
    printedAt: new Date('2026-09-10T09:00:00Z'),
  };

  it('fits a short run on one page', () => {
    expect(asText(renderManifest(manifest))).toContain('/Count 1');
  });

  it('breaks a long run across pages', () => {
    const many = {
      ...manifest,
      stops: Array.from({ length: 65 }, (_, index) => ({ ...manifest.stops[0]!, position: index + 1 })),
    };
    expect(asText(renderManifest(many))).toContain('/Count 3');
  });

  it('prints the cash total the office will count in', () => {
    expect(asText(renderManifest(manifest))).toContain('7 500 DA');
  });

  it('prints a signature line for the driver and for the cashier', () => {
    const text = asText(renderManifest(manifest));
    expect(text).toContain('Signature chauffeur');
    expect(text).toContain('Signature caisse');
  });

  it('handles a run with no stops', () => {
    const empty = { ...manifest, stops: [], expectedCashMinor: 0n };
    expect(asText(renderManifest(empty))).toContain('%PDF-1.4');
  });
});
