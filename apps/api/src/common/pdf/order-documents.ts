import { A4, PdfDocument } from './pdf-document.js';
import { formatDa } from './delivery-documents.js';

/**
 * The two pieces of paper an order needs — PRD F-AD-36.
 *
 * An invoice for the customer and the accountant, and a packing slip for whoever fills
 * the box. They are deliberately different documents: the invoice carries money and the
 * shop's legal identifiers, the packing slip carries none, because the person packing a
 * parcel does not need to know the margin and the box should not tell the customer's
 * neighbour what it cost.
 *
 * Both are pure — data in, bytes out — so they are tested without a printer.
 */

export interface OrderDocumentLine {
  name: string;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  unitPriceMinor: bigint;
  totalMinor: bigint;
}

export interface InvoiceData {
  orderNumber: string;
  placedAt: Date;
  shopName: string;
  shopAddress: string | null;
  shopPhone: string | null;
  shopEmail: string | null;
  /** Algerian trade identifiers. Omitted from the document when the shop has none. */
  shopRc: string | null;
  shopNif: string | null;
  shopArt: string | null;
  customerName: string;
  customerPhone: string;
  address: string | null;
  communeName: string | null;
  wilayaName: string;
  lines: OrderDocumentLine[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  totalMinor: bigint;
  /** What the driver still has to collect. Zero once an order is paid. */
  dueMinor: bigint;
  paymentLabel: string;
  isPaid: boolean;
  printedAt: Date;
}

export interface PackingSlipData {
  orderNumber: string;
  placedAt: Date;
  shopName: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  communeName: string | null;
  wilayaName: string;
  isStopDesk: boolean;
  pickupPointName: string | null;
  lines: OrderDocumentLine[];
  note: string | null;
  printedAt: Date;
}

const MARGIN = 40;
const RIGHT = A4.width - MARGIN;

/**
 * One invoice per page, several orders per document.
 *
 * Batch printing is the normal case: an owner confirms the morning's orders and prints
 * them in one go rather than opening twenty tabs.
 */
export function renderInvoices(invoices: InvoiceData[]): Buffer {
  const pdf = new PdfDocument(A4);

  for (const invoice of invoices.length > 0 ? invoices : []) {
    drawInvoice(pdf, invoice);
  }

  // A document with no pages is not a valid PDF. An empty selection gets a sheet that
  // says so rather than a file the reader refuses to open.
  if (invoices.length === 0) drawEmpty(pdf, 'Aucune facture à imprimer');

  return pdf.build();
}

export function renderPackingSlips(slips: PackingSlipData[]): Buffer {
  const pdf = new PdfDocument(A4);

  for (const slip of slips) {
    drawPackingSlip(pdf, slip);
  }

  if (slips.length === 0) drawEmpty(pdf, 'Aucun bon de préparation à imprimer');

  return pdf.build();
}

function drawInvoice(pdf: PdfDocument, data: InvoiceData): void {
  pdf.addPage(A4);

  // --- header ----------------------------------------------------------------
  pdf.text(data.shopName, MARGIN, 52, { font: 'Helvetica-Bold', size: 16 });

  let y = 68;
  for (const line of [data.shopAddress, data.shopPhone, data.shopEmail].filter(Boolean)) {
    pdf.text(String(line), MARGIN, y, { size: 9, gray: 0.4 });
    y += 12;
  }

  // RC, NIF and article number are what makes an Algerian invoice an invoice. A shop
  // that has not entered them gets a clean document rather than empty labels.
  const identifiers = [
    data.shopRc ? `RC ${data.shopRc}` : null,
    data.shopNif ? `NIF ${data.shopNif}` : null,
    data.shopArt ? `Art. ${data.shopArt}` : null,
  ].filter(Boolean);

  if (identifiers.length > 0) {
    pdf.text(identifiers.join(' · '), MARGIN, y, { size: 8, gray: 0.5 });
    y += 12;
  }

  pdf.text('FACTURE', MARGIN, 52, { font: 'Helvetica-Bold', size: 16, align: 'right', width: RIGHT });
  pdf.text(data.orderNumber, MARGIN, 72, { size: 11, align: 'right', width: RIGHT });
  pdf.text(formatDate(data.placedAt), MARGIN, 88, { size: 9, gray: 0.4, align: 'right', width: RIGHT });

  y = Math.max(y, 104);
  pdf.line(MARGIN, y, RIGHT, y, 0.4);
  y += 20;

  // --- billed to ---------------------------------------------------------------
  pdf.text('Facturé à', MARGIN, y, { size: 8, gray: 0.45 });
  y += 14;
  pdf.text(data.customerName, MARGIN, y, { font: 'Helvetica-Bold', size: 11 });
  y += 13;
  pdf.text(data.customerPhone, MARGIN, y, { size: 9 });
  y += 12;

  const place = [data.address, data.communeName, data.wilayaName].filter(Boolean).join(', ');
  y = pdf.paragraph(place, MARGIN, y, 280, { size: 9, gray: 0.35 });

  y += 18;

  // --- lines -------------------------------------------------------------------
  y = drawLineTable(pdf, data.lines, y, { withMoney: true });

  // --- totals ------------------------------------------------------------------
  y += 8;
  const labelX = RIGHT - 220;

  y = totalRow(pdf, 'Sous-total', formatDa(data.subtotalMinor), labelX, y);

  if (data.discountMinor > 0n) {
    y = totalRow(pdf, 'Remise', `− ${formatDa(data.discountMinor)}`, labelX, y);
  }

  y = totalRow(
    pdf,
    'Livraison',
    data.shippingMinor > 0n ? formatDa(data.shippingMinor) : 'Offerte',
    labelX,
    y,
  );

  y += 6;
  pdf.line(labelX, y, RIGHT, y, 0.4);
  y += 18;

  pdf.text('Total', labelX, y, { font: 'Helvetica-Bold', size: 12 });
  pdf.text(formatDa(data.totalMinor), MARGIN, y, {
    font: 'Helvetica-Bold',
    size: 13,
    align: 'right',
    width: RIGHT,
  });

  y += 22;
  pdf.text(data.paymentLabel, labelX, y, { size: 9, gray: 0.4 });

  if (!data.isPaid && data.dueMinor > 0n) {
    y += 16;
    // The number the driver reads at the door. It is the whole point of the document
    // for a cash-on-delivery shop, so it is set apart rather than buried in the totals.
    pdf.rect(labelX, y - 12, RIGHT - labelX, 30, { fill: 0.94 });
    pdf.text('À payer à la livraison', labelX + 8, y + 6, { font: 'Helvetica-Bold', size: 10 });
    pdf.text(formatDa(data.dueMinor), MARGIN, y + 6, {
      font: 'Helvetica-Bold',
      size: 12,
      align: 'right',
      width: RIGHT - 8,
    });
    y += 30;
  }

  footer(pdf, `${data.shopName} · ${data.orderNumber}`, data.printedAt);
}

function drawPackingSlip(pdf: PdfDocument, data: PackingSlipData): void {
  pdf.addPage(A4);

  pdf.text(data.shopName, MARGIN, 52, { font: 'Helvetica-Bold', size: 14 });
  pdf.text('BON DE PRÉPARATION', MARGIN, 52, {
    font: 'Helvetica-Bold',
    size: 14,
    align: 'right',
    width: RIGHT,
  });
  pdf.text(data.orderNumber, MARGIN, 72, { size: 11, align: 'right', width: RIGHT });
  pdf.text(formatDate(data.placedAt), MARGIN, 72, { size: 9, gray: 0.4 });

  let y = 92;
  pdf.line(MARGIN, y, RIGHT, y, 0.4);
  y += 20;

  pdf.text(data.customerName, MARGIN, y, { font: 'Helvetica-Bold', size: 11 });
  pdf.text(data.customerPhone, MARGIN, y, { size: 10, align: 'right', width: RIGHT });
  y += 14;

  const destination = data.isStopDesk
    ? `Point de retrait : ${data.pickupPointName ?? data.wilayaName}`
    : [data.address, data.communeName, data.wilayaName].filter(Boolean).join(', ');

  y = pdf.paragraph(destination, MARGIN, y, RIGHT - MARGIN, { size: 9, gray: 0.35 });
  y += 18;

  // No prices. Whoever packs the box does not need them, and a slip in the parcel
  // showing what the neighbour paid is how a shop gets an awkward phone call.
  y = drawLineTable(pdf, data.lines, y, { withMoney: false });

  const units = data.lines.reduce((sum, line) => sum + line.quantity, 0);
  y += 16;
  pdf.text(`${units} article${units > 1 ? 's' : ''} au total`, MARGIN, y, {
    font: 'Helvetica-Bold',
    size: 10,
  });

  if (data.note) {
    y += 22;
    pdf.text('Note', MARGIN, y, { size: 8, gray: 0.45 });
    y += 13;
    y = pdf.paragraph(data.note, MARGIN, y, RIGHT - MARGIN, { size: 9 });
  }

  y += 34;
  pdf.text('Préparé par', MARGIN, y, { size: 8, gray: 0.45 });
  pdf.line(MARGIN + 60, y + 2, MARGIN + 220, y + 2, 0.6);
  pdf.text('Vérifié par', MARGIN + 260, y, { size: 8, gray: 0.45 });
  pdf.line(MARGIN + 320, y + 2, RIGHT, y + 2, 0.6);

  footer(pdf, `${data.shopName} · ${data.orderNumber}`, data.printedAt);
}

/** The line table, shared by both documents; money columns are optional. */
function drawLineTable(
  pdf: PdfDocument,
  lines: OrderDocumentLine[],
  startY: number,
  options: { withMoney: boolean },
): number {
  const columns = options.withMoney
    ? { name: MARGIN, qty: RIGHT - 200, unit: RIGHT - 150, total: RIGHT }
    : { name: MARGIN, qty: RIGHT - 60, unit: 0, total: 0 };

  let y = startY;

  pdf.text('Article', columns.name, y, { size: 8, gray: 0.45 });
  pdf.text('Qté', columns.qty, y, { size: 8, gray: 0.45 });

  if (options.withMoney) {
    pdf.text('P.U.', columns.unit, y, { size: 8, gray: 0.45 });
    pdf.text('Total', MARGIN, y, { size: 8, gray: 0.45, align: 'right', width: columns.total });
  }

  y += 6;
  pdf.line(MARGIN, y, RIGHT, y, 0.4);

  for (const line of lines) {
    y += 20;

    pdf.text(truncate(line.name, options.withMoney ? 46 : 58), columns.name, y, { size: 10 });

    const detail = [line.variantLabel, line.sku ? `SKU ${line.sku}` : null]
      .filter(Boolean)
      .join(' · ');

    if (detail) {
      y += 11;
      pdf.text(detail, columns.name, y, { size: 8, gray: 0.45 });
    }

    // The quantity sits on the first line of the row, not the detail line.
    const rowY = detail ? y - 11 : y;
    pdf.text(String(line.quantity), columns.qty, rowY, { size: 10, font: 'Helvetica-Bold' });

    if (options.withMoney) {
      pdf.text(formatDa(line.unitPriceMinor), columns.unit, rowY, { size: 9 });
      pdf.text(formatDa(line.totalMinor), MARGIN, rowY, {
        size: 10,
        align: 'right',
        width: columns.total,
      });
    }

    pdf.line(MARGIN, y + 8, RIGHT, y + 8, 0.9);
  }

  return y + 16;
}

function totalRow(pdf: PdfDocument, label: string, value: string, labelX: number, y: number): number {
  const next = y + 16;
  pdf.text(label, labelX, next, { size: 9, gray: 0.35 });
  pdf.text(value, MARGIN, next, { size: 10, align: 'right', width: RIGHT });
  return next;
}

function drawEmpty(pdf: PdfDocument, message: string): void {
  pdf.addPage(A4);
  pdf.text(message, MARGIN, 120, { size: 12, gray: 0.4 });
}

function footer(pdf: PdfDocument, left: string, printedAt: Date): void {
  const y = A4.height - 40;
  pdf.line(MARGIN, y - 14, RIGHT, y - 14, 0.85);
  pdf.text(left, MARGIN, y, { size: 8, gray: 0.5 });
  pdf.text(`Imprimé le ${formatDateTime(printedAt)}`, MARGIN, y, {
    size: 8,
    gray: 0.5,
    align: 'right',
    width: RIGHT,
  });
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Africa/Algiers',
  }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Algiers',
  }).format(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
