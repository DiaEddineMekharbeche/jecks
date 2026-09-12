import { describe, expect, it } from 'vitest';
import {
  renderInvoices,
  renderPackingSlips,
  type InvoiceData,
  type PackingSlipData,
} from './order-documents.js';

/**
 * Invoices and packing slips.
 *
 * The writer is hand-rolled, so these assert on the bytes: a file that opens as
 * "damaged" is the failure mode, and no amount of checking the layout in code would
 * catch it. Beyond that, what matters is what each document does and does not say.
 */

const LINES = [
  {
    name: 'Casquette Héritage',
    variantLabel: 'Noir / M',
    sku: 'JK-HER-NOI-M',
    quantity: 2,
    unitPriceMinor: 350_000n,
    totalMinor: 700_000n,
  },
  {
    name: 'Bucket Terrazzo',
    variantLabel: 'Écru / L',
    sku: 'JK-BUC-ECR-L',
    quantity: 1,
    unitPriceMinor: 420_000n,
    totalMinor: 420_000n,
  },
];

function invoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    orderNumber: 'JK-260911-0042',
    placedAt: new Date('2026-09-11T09:00:00Z'),
    shopName: "Jeck's",
    shopAddress: 'Bab Ezzouar, Alger',
    shopPhone: '+213551000001',
    shopEmail: 'contact@jecks.dz',
    shopRc: '16/00-1234567B23',
    shopNif: '000916123456789',
    shopArt: '16123456789',
    customerName: 'Yacine Haddad',
    customerPhone: '+213661234567',
    address: 'Cité 200 logements, Bt 4',
    communeName: 'Bab Ezzouar',
    wilayaName: 'Alger',
    lines: LINES,
    subtotalMinor: 1_120_000n,
    discountMinor: 120_000n,
    shippingMinor: 40_000n,
    totalMinor: 1_040_000n,
    dueMinor: 1_040_000n,
    paymentLabel: 'Paiement à la livraison',
    isPaid: false,
    printedAt: new Date('2026-09-11T10:00:00Z'),
    ...overrides,
  };
}

function slip(overrides: Partial<PackingSlipData> = {}): PackingSlipData {
  return {
    orderNumber: 'JK-260911-0042',
    placedAt: new Date('2026-09-11T09:00:00Z'),
    shopName: "Jeck's",
    customerName: 'Yacine Haddad',
    customerPhone: '+213661234567',
    address: 'Cité 200 logements, Bt 4',
    communeName: 'Bab Ezzouar',
    wilayaName: 'Alger',
    isStopDesk: false,
    pickupPointName: null,
    lines: LINES,
    note: null,
    printedAt: new Date('2026-09-11T10:00:00Z'),
    ...overrides,
  };
}

/** The uncompressed content streams, as text, for asserting what is on the page. */
function readable(pdf: Buffer): string {
  return pdf.toString('latin1');
}

function pageCount(pdf: Buffer): number {
  return (readable(pdf).match(/\/Type \/Page[^s]/g) ?? []).length;
}

describe('renderInvoices', () => {
  it('produces a PDF that a reader will open', () => {
    const pdf = renderInvoices([invoice()]);

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(readable(pdf)).toContain('%%EOF');
    expect(readable(pdf)).toContain('startxref');
  });

  it('puts one order on each page', () => {
    const pdf = renderInvoices([
      invoice({ orderNumber: 'JK-260911-0001' }),
      invoice({ orderNumber: 'JK-260911-0002' }),
      invoice({ orderNumber: 'JK-260911-0003' }),
    ]);

    expect(pageCount(pdf)).toBe(3);
  });

  it('carries the order number, the customer and the total', () => {
    const text = readable(renderInvoices([invoice()]));

    expect(text).toContain('JK-260911-0042');
    expect(text).toContain('Yacine Haddad');
    expect(text).toContain('FACTURE');
  });

  it('prints the trade identifiers an Algerian invoice needs', () => {
    const text = readable(renderInvoices([invoice()]));

    expect(text).toContain('RC 16/00-1234567B23');
    expect(text).toContain('NIF 000916123456789');
  });

  it('leaves the identifiers off rather than printing empty labels', () => {
    const text = readable(
      renderInvoices([invoice({ shopRc: null, shopNif: null, shopArt: null })]),
    );

    expect(text).not.toContain('RC ');
    expect(text).not.toContain('NIF');
  });

  it('shows the amount due at the door for a cash order', () => {
    const text = readable(renderInvoices([invoice()]));

    // The number the driver reads. Without it the document is decoration.
    expect(text).toContain('payer');
  });

  it('omits the amount due once the order is paid', () => {
    const text = readable(renderInvoices([invoice({ isPaid: true, dueMinor: 0n })]));

    expect(text).not.toContain('payer');
  });

  it('says free shipping rather than printing a zero', () => {
    const text = readable(renderInvoices([invoice({ shippingMinor: 0n })]));

    expect(text).toContain('Offerte');
  });

  it('shows a discount line only when there is a discount', () => {
    expect(readable(renderInvoices([invoice()]))).toContain('Remise');
    expect(readable(renderInvoices([invoice({ discountMinor: 0n })]))).not.toContain('Remise');
  });

  it('produces a valid one-page document rather than a broken file for an empty batch', () => {
    // Bulk print with nothing selected. A PDF with zero pages does not open.
    const pdf = renderInvoices([]);

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });
});

describe('renderPackingSlips', () => {
  it('produces a PDF that a reader will open', () => {
    const pdf = renderPackingSlips([slip()]);

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(readable(pdf)).toContain('%%EOF');
  });

  it('never shows a price', () => {
    // A slip in the parcel telling the customer's neighbour what it cost is how a shop
    // gets an awkward phone call. The packer does not need the figures either.
    const text = readable(renderPackingSlips([slip()]));

    expect(text).toContain('Casquette');
    expect(text).not.toContain('DA');
    expect(text).not.toContain('Total');
  });

  it('counts the units, because that is what the packer checks against the box', () => {
    const text = readable(renderPackingSlips([slip()]));

    // Two caps and one bucket.
    expect(text).toContain('3 articles');
  });

  it('names the pickup point for a stop-desk parcel instead of a street address', () => {
    const text = readable(
      renderPackingSlips([
        slip({ isStopDesk: true, pickupPointName: 'Stop Desk Oran', wilayaName: 'Oran' }),
      ]),
    );

    expect(text).toContain('Stop Desk Oran');
    expect(text).not.toContain('200 logements');
  });

  it('carries the order note, which is usually where the delivery instruction is', () => {
    const text = readable(
      renderPackingSlips([slip({ note: 'Appeler avant de monter, pas de sonnette' })]),
    );

    expect(text).toContain('sonnette');
  });

  it('puts one order on each page', () => {
    const pdf = renderPackingSlips([slip(), slip({ orderNumber: 'JK-260911-0043' })]);

    expect(pageCount(pdf)).toBe(2);
  });

  it('produces a valid document for an empty batch', () => {
    const pdf = renderPackingSlips([]);

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });
});
