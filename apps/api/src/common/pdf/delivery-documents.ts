import { A4, LABEL_10x15, PdfDocument } from './pdf-document.js';

/**
 * The two pieces of paper a delivery needs — PRD F-AD-61 and F-AD-62.
 *
 * A parcel label, printed on the 10×15 thermal roll every Algerian courier uses, and a
 * run manifest the driver signs and the office keeps. Both are pure: they take data and
 * return bytes, so they can be tested without a printer.
 *
 * Everything on them is in French, because that is what is read at the door.
 */

export interface LabelData {
  orderNumber: string;
  trackingNumber: string | null;
  shopName: string;
  shopPhone: string | null;
  customerName: string;
  customerPhone: string;
  altPhone: string | null;
  address: string | null;
  communeName: string | null;
  wilayaCode: number;
  wilayaName: string;
  isStopDesk: boolean;
  pickupPointName: string | null;
  codAmountMinor: bigint;
  itemCount: number;
  weightGrams: number;
  courierName: string | null;
  note: string | null;
  printedAt: Date;
}

export interface ManifestData {
  runCode: string;
  date: Date;
  driverName: string;
  driverPhone: string;
  vehicleLabel: string | null;
  shopName: string;
  stops: Array<{
    position: number;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    address: string | null;
    communeName: string | null;
    wilayaName: string;
    itemCount: number;
    codAmountMinor: bigint;
  }>;
  expectedCashMinor: bigint;
  distanceKm: number;
  printedAt: Date;
}

const MARGIN = 12;

/** Dinars with a space every three digits, the way an invoice reads here. */
export function formatDa(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const dinars = absolute / 100n;
  const centimes = absolute % 100n;

  // A plain space, not U+00A0. The label transliterates it to one anyway, and an
  // invisible character that breaks every string comparison buys nothing here.
  const grouped = dinars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const tail = centimes === 0n ? '' : `,${centimes.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${grouped}${tail} DA`;
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

/**
 * One parcel label per page.
 *
 * The layout puts the cash amount in the largest type on the page. A driver reads this
 * at a doorstep, often in the dark, and the one number that must not be misread is what
 * they are supposed to collect.
 */
export function renderLabels(labels: LabelData[]): Buffer {
  const pdf = new PdfDocument(LABEL_10x15);

  for (const label of labels) {
    pdf.addPage(LABEL_10x15);
    const { width } = pdf.size;
    const inner = width - MARGIN * 2;

    pdf.rect(MARGIN / 2, MARGIN / 2, width - MARGIN, pdf.size.height - MARGIN, { stroke: 0.2 });

    let y = MARGIN + 12;
    pdf.text(label.shopName, MARGIN, y, { font: 'Helvetica-Bold', size: 12 });
    if (label.shopPhone) {
      pdf.text(label.shopPhone, MARGIN, y, { size: 8, align: 'right', width: width - MARGIN });
    }

    y += 8;
    pdf.line(MARGIN, y, width - MARGIN, y, 0.6);

    // The barcode is the order number, which is what our own screens search by.
    y += 10;
    pdf.barcode(label.orderNumber, MARGIN, y, inner, 34);
    y += 34 + 10;
    pdf.text(label.orderNumber, MARGIN, y, {
      font: 'Helvetica-Bold',
      size: 11,
      align: 'center',
      width: width - MARGIN,
    });

    if (label.trackingNumber) {
      y += 12;
      pdf.text(`Suivi : ${label.trackingNumber}`, MARGIN, y, {
        size: 8,
        gray: 0.35,
        align: 'center',
        width: width - MARGIN,
      });
    }

    y += 12;
    pdf.line(MARGIN, y, width - MARGIN, y, 0.6);

    y += 14;
    pdf.text('DESTINATAIRE', MARGIN, y, { size: 7, gray: 0.45 });
    y += 12;
    pdf.text(label.customerName, MARGIN, y, { font: 'Helvetica-Bold', size: 11 });
    y += 12;
    pdf.text(label.customerPhone, MARGIN, y, { size: 10 });
    if (label.altPhone) {
      pdf.text(label.altPhone, MARGIN, y, { size: 9, gray: 0.4, align: 'right', width: width - MARGIN });
    }

    y += 14;
    const destination = label.isStopDesk
      ? `STOP DESK — ${label.pickupPointName ?? label.wilayaName}`
      : (label.address ?? 'Adresse à confirmer par téléphone');
    y = pdf.paragraph(destination, MARGIN, y, inner, { size: 9 });

    y += 2;
    pdf.text(
      `${String(label.wilayaCode).padStart(2, '0')} ${label.wilayaName}${
        label.communeName ? ` — ${label.communeName}` : ''
      }`,
      MARGIN,
      y,
      { font: 'Helvetica-Bold', size: 10 },
    );

    y += 10;
    pdf.line(MARGIN, y, width - MARGIN, y, 0.6);

    // The number that matters.
    y += 16;
    if (label.codAmountMinor > 0n) {
      pdf.text('À ENCAISSER', MARGIN, y, { size: 8, gray: 0.45 });
      y += 22;
      pdf.text(formatDa(label.codAmountMinor), MARGIN, y, { font: 'Helvetica-Bold', size: 20 });
    } else {
      pdf.text('DÉJÀ PAYÉ — NE RIEN ENCAISSER', MARGIN, y, {
        font: 'Helvetica-Bold',
        size: 11,
      });
      y += 12;
    }

    y += 16;
    pdf.text(
      `${label.itemCount} article${label.itemCount > 1 ? 's' : ''} · ${(label.weightGrams / 1000).toFixed(
        1,
      )} kg${label.courierName ? ` · ${label.courierName}` : ''}`,
      MARGIN,
      y,
      { size: 8, gray: 0.4 },
    );

    if (label.note) {
      y += 12;
      y = pdf.paragraph(label.note, MARGIN, y, inner, { size: 8, gray: 0.35 });
    }

    pdf.text(formatDateTime(label.printedAt), MARGIN, pdf.size.height - MARGIN - 2, {
      size: 7,
      gray: 0.5,
    });
  }

  return pdf.build();
}

/**
 * The run manifest — one A4 page listing the stops in the order the driver will drive
 * them, with a signature line at the end.
 *
 * The cash column adds up, and the total is what the office counts in when the driver
 * comes back. That reconciliation is the whole point of the sheet.
 */
export function renderManifest(data: ManifestData): Buffer {
  const pdf = new PdfDocument(A4);
  const margin = 40;

  const columns = { position: margin, order: margin + 26, customer: margin + 110, place: margin + 250, items: margin + 400, cash: margin + 440 };
  const right = A4.width - margin;
  const rowsPerPage = 30;

  const pages = Math.max(1, Math.ceil(data.stops.length / rowsPerPage));

  for (let page = 0; page < pages; page += 1) {
    pdf.addPage(A4);

    pdf.text(data.shopName, margin, 46, { font: 'Helvetica-Bold', size: 14 });
    pdf.text(`Feuille de tournée ${data.runCode}`, margin, 64, { size: 11 });
    pdf.text(formatDate(data.date), margin, 46, { size: 11, align: 'right', width: right });
    pdf.text(`Page ${page + 1}/${pages}`, margin, 64, { size: 9, gray: 0.45, align: 'right', width: right });

    pdf.text(
      `Chauffeur : ${data.driverName} (${data.driverPhone})${
        data.vehicleLabel ? ` · ${data.vehicleLabel}` : ''
      }`,
      margin,
      82,
      { size: 9, gray: 0.3 },
    );
    pdf.text(
      `${data.stops.length} arrêt${data.stops.length > 1 ? 's' : ''} · ${data.distanceKm.toFixed(
        1,
      )} km à vol d'oiseau`,
      margin,
      82,
      { size: 9, gray: 0.45, align: 'right', width: right },
    );

    let y = 104;
    pdf.line(margin, y, right, y, 0.4);
    y += 12;
    pdf.text('#', columns.position, y, { size: 8, gray: 0.45 });
    pdf.text('Commande', columns.order, y, { size: 8, gray: 0.45 });
    pdf.text('Client', columns.customer, y, { size: 8, gray: 0.45 });
    pdf.text('Adresse', columns.place, y, { size: 8, gray: 0.45 });
    pdf.text('Art.', columns.items, y, { size: 8, gray: 0.45 });
    pdf.text('À encaisser', columns.cash, y, { size: 8, gray: 0.45, align: 'right', width: right });
    y += 6;
    pdf.line(margin, y, right, y, 0.4);

    const slice = data.stops.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    for (const stop of slice) {
      y += 18;
      pdf.text(String(stop.position), columns.position, y, { size: 9 });
      pdf.text(stop.orderNumber, columns.order, y, { size: 9, font: 'Helvetica-Bold' });
      pdf.text(truncate(stop.customerName, 24), columns.customer, y, { size: 9 });
      pdf.text(truncate(stop.customerPhone, 20), columns.customer, y + 10, { size: 8, gray: 0.45 });
      pdf.text(
        truncate(stop.address ?? `${stop.communeName ?? ''} ${stop.wilayaName}`.trim(), 32),
        columns.place,
        y,
        { size: 8 },
      );
      pdf.text(String(stop.itemCount), columns.items, y, { size: 9 });
      pdf.text(stop.codAmountMinor > 0n ? formatDa(stop.codAmountMinor) : '—', columns.cash, y, {
        size: 9,
        align: 'right',
        width: right,
      });
      y += 10;
      pdf.line(margin, y + 4, right, y + 4, 0.9);
    }

    if (page === pages - 1) {
      y += 30;
      pdf.line(margin, y, right, y, 0.4);
      y += 18;
      pdf.text('Total à encaisser', columns.place, y, { font: 'Helvetica-Bold', size: 11 });
      pdf.text(formatDa(data.expectedCashMinor), columns.cash, y, {
        font: 'Helvetica-Bold',
        size: 12,
        align: 'right',
        width: right,
      });

      y += 46;
      pdf.text('Signature chauffeur', margin, y, { size: 8, gray: 0.45 });
      pdf.line(margin, y + 34, margin + 180, y + 34, 0.5);
      pdf.text('Signature caisse', margin + 240, y, { size: 8, gray: 0.45 });
      pdf.line(margin + 240, y + 34, margin + 420, y + 34, 0.5);
    }

    pdf.text(`Imprimée le ${formatDateTime(data.printedAt)}`, margin, A4.height - 30, {
      size: 7,
      gray: 0.5,
    });
  }

  return pdf.build();
}

function truncate(value: string, max: number): string {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
