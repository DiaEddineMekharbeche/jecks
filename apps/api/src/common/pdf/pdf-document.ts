/**
 * A very small PDF writer — enough for delivery labels and run manifests.
 *
 * Written by hand rather than pulled in, for the same reason the mailer speaks ESMTP
 * directly: the platform needs text, lines, boxes and a barcode on A4 or a 10×15 label,
 * and every library that does that also does forms, encryption, images and font
 * subsetting. This file is 300 lines that never change and cannot break at install time.
 *
 * It writes PDF 1.4 with the base-14 Helvetica faces, which every reader and every
 * printer has had since 1993. Text is encoded as WinAnsi, so French accents work;
 * anything outside that range is transliterated rather than silently dropped, because a
 * label with a mangled name is still deliverable and a label with a blank one is not.
 */

export interface PageSize {
  width: number;
  height: number;
}

/** Points, at 72 per inch. */
export const A4: PageSize = { width: 595.28, height: 841.89 };
/** The 10×15 cm thermal label every Algerian courier prints on. */
export const LABEL_10x15: PageSize = { width: 283.46, height: 425.2 };

export type FontName = 'Helvetica' | 'Helvetica-Bold';

export interface TextOptions {
  font?: FontName;
  size?: number;
  /** 0 is black, 1 is white. */
  gray?: number;
  align?: 'left' | 'center' | 'right';
  /** Right edge used by `center` and `right`; defaults to the page width. */
  width?: number;
}

export class PdfDocument {
  private readonly pages: Array<{ size: PageSize; content: string[] }> = [];
  private current: { size: PageSize; content: string[] } | null = null;

  constructor(private readonly defaultSize: PageSize = A4) {}

  addPage(size: PageSize = this.defaultSize): this {
    this.current = { size, content: [] };
    this.pages.push(this.current);
    return this;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get size(): PageSize {
    return this.page().size;
  }

  /**
   * Draws a line of text with its baseline at `y`, measured from the top.
   *
   * Top-down coordinates because every layout in this codebase is written top-down;
   * PDF's own bottom-left origin is an implementation detail that stops here.
   */
  text(value: string, x: number, y: number, options: TextOptions = {}): this {
    const page = this.page();
    const { font = 'Helvetica', size = 10, gray = 0, align = 'left' } = options;
    const width = options.width ?? page.size.width;

    const line = String(value ?? '');
    const drawn = align === 'left' ? x : alignedX(line, font, size, x, width, align);

    page.content.push(
      'BT',
      `/${font === 'Helvetica-Bold' ? 'F2' : 'F1'} ${round(size)} Tf`,
      `${round(gray)} g`,
      `1 0 0 1 ${round(drawn)} ${round(page.size.height - y)} Tm`,
      `(${escapeText(line)}) Tj`,
      'ET',
    );
    return this;
  }

  /** Wraps text into a column and returns the y just below the last line drawn. */
  paragraph(value: string, x: number, y: number, width: number, options: TextOptions = {}): number {
    const { font = 'Helvetica', size = 10 } = options;
    const leading = size * 1.35;
    let cursor = y;

    for (const line of wrap(value, font, size, width)) {
      this.text(line, x, cursor, options);
      cursor += leading;
    }
    return cursor;
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.75, thickness = 0.6): this {
    const page = this.page();
    page.content.push(
      `${round(gray)} G`,
      `${round(thickness)} w`,
      `${round(x1)} ${round(page.size.height - y1)} m`,
      `${round(x2)} ${round(page.size.height - y2)} l`,
      'S',
    );
    return this;
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    options: { fill?: number; stroke?: number; thickness?: number } = {},
  ): this {
    const page = this.page();
    const top = page.size.height - y - height;
    const parts: string[] = [];

    if (options.fill !== undefined) parts.push(`${round(options.fill)} g`);
    if (options.stroke !== undefined) {
      parts.push(`${round(options.stroke)} G`, `${round(options.thickness ?? 0.6)} w`);
    }
    parts.push(`${round(x)} ${round(top)} ${round(width)} ${round(height)} re`);

    if (options.fill !== undefined && options.stroke !== undefined) parts.push('B');
    else if (options.fill !== undefined) parts.push('f');
    else parts.push('S');

    page.content.push(...parts);
    return this;
  }

  /**
   * A Code 128-B barcode, drawn as filled bars.
   *
   * Couriers scan these off our label when a parcel is handed over, and a wrong check
   * digit is a parcel that has to be typed in by hand at the counter, so the checksum
   * is computed rather than approximated.
   */
  barcode(value: string, x: number, y: number, width: number, height: number): this {
    const pattern = code128b(value);
    const symbolModules = pattern.reduce((total, bar) => total + bar, 0);
    // Ten blank modules each side. A scanner needs that silence to find the first bar,
    // and a barcode printed hard against a border is one nobody can read.
    const unit = width / (symbolModules + QUIET_ZONE_MODULES * 2);

    let cursor = x + QUIET_ZONE_MODULES * unit;
    let dark = true;
    for (const bars of pattern) {
      const barWidth = bars * unit;
      if (dark) this.rect(cursor, y, barWidth, height, { fill: 0 });
      cursor += barWidth;
      dark = !dark;
    }
    return this;
  }

  /** Width of a string at a given size, in points. */
  measure(value: string, font: FontName, size: number): number {
    return textWidth(value, font, size);
  }

  /** The finished file. */
  build(): Buffer {
    if (this.pages.length === 0) this.addPage();

    const pageObjectIds: number[] = [];

    // 1 catalog, 2 pages, 3 and 4 fonts, then a pair per page.
    const catalogId = 1;
    const pagesId = 2;
    const fontRegularId = 3;
    const fontBoldId = 4;
    let nextId = 5;

    const bodies = new Map<number, string>();

    for (const page of this.pages) {
      const contentId = nextId;
      nextId += 1;
      const pageId = nextId;
      nextId += 1;
      pageObjectIds.push(pageId);

      const stream = page.content.join('\n');
      bodies.set(
        contentId,
        `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`,
      );
      bodies.set(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${round(page.size.width)} ${round(
          page.size.height,
        )}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
    }

    bodies.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    bodies.set(
      pagesId,
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${
        pageObjectIds.length
      } >>`,
    );
    bodies.set(
      fontRegularId,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    bodies.set(
      fontBoldId,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );

    let file = '%PDF-1.4\n';
    const offsets = new Map<number, number>();

    for (let id = 1; id < nextId; id += 1) {
      const body = bodies.get(id);
      if (!body) continue;
      offsets.set(id, Buffer.byteLength(file, 'binary'));
      file += `${id} 0 obj\n${body}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(file, 'binary');
    file += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
    for (let id = 1; id < nextId; id += 1) {
      const offset = offsets.get(id) ?? 0;
      file += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    file += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(file, 'binary');
  }

  private page(): { size: PageSize; content: string[] } {
    if (!this.current) this.addPage();
    return this.current!;
  }
}

// --- text metrics -----------------------------------------------------------

/**
 * Helvetica advance widths, in thousandths of an em.
 *
 * Only what a label uses: ASCII plus the accented characters French needs. Anything
 * absent falls back to 556, the width of a lowercase letter, which is close enough that
 * a centred line stays centred.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
  R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const BOLD_FACTOR = 1.07;

function charWidth(character: string, font: FontName): number {
  const base = HELVETICA_WIDTHS[character] ?? 556;
  return font === 'Helvetica-Bold' ? base * BOLD_FACTOR : base;
}

export function textWidth(value: string, font: FontName, size: number): number {
  let total = 0;
  for (const character of value) total += charWidth(character, font);
  return (total * size) / 1000;
}

function alignedX(
  value: string,
  font: FontName,
  size: number,
  x: number,
  width: number,
  align: 'center' | 'right',
): number {
  const measured = textWidth(value, font, size);
  return align === 'center' ? x + (width - x - measured) / 2 : width - measured;
}

/** Greedy word wrap; a word longer than the column is cut rather than overflowing. */
export function wrap(value: string, font: FontName, size: number, width: number): string[] {
  const words = String(value ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, font, size) <= width || line === '') {
      line = candidate;
      // A single word wider than the column has to be broken somewhere.
      while (textWidth(line, font, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), font, size) > width) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

// --- encoding ---------------------------------------------------------------

/** Characters WinAnsi cannot hold, mapped to something a courier can still read. */
const TRANSLITERATIONS: Record<string, string> = {
  '’': "'", '‘': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ',
};

export function escapeText(value: string): string {
  let out = '';
  for (const character of value) {
    const mapped = TRANSLITERATIONS[character] ?? character;
    for (const piece of mapped) {
      const code = piece.codePointAt(0) ?? 63;
      if (piece === '(' || piece === ')' || piece === '\\') out += `\\${piece}`;
      else if (code < 32) out += ' ';
      else if (code <= 255) out += code > 126 ? `\\${code.toString(8).padStart(3, '0')}` : piece;
      // Arabic and anything else outside Latin-1: a question mark, never a blank.
      else out += '?';
    }
  }
  return out;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

// --- Code 128 ---------------------------------------------------------------

/**
 * Bar and space widths for each Code 128 symbol, in modules.
 *
 * The published table, values 0 to 106. It is transcribed rather than derived because
 * there is no formula behind it, and a single wrong row prints a barcode that scans as
 * a different parcel.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];
const QUIET_ZONE_MODULES = 10;
const START_B = 104;
const STOP = 106;

/**
 * Encodes a string as Code 128-B and returns alternating bar and space widths.
 *
 * Characters outside the printable ASCII range are replaced with a space: a scanner
 * that reads a name with a missing accent is doing its job, and one that reads nothing
 * because the symbol was invalid is not.
 */
export function code128b(value: string): number[] {
  const codes: number[] = [START_B];
  let checksum = START_B;

  [...value].forEach((character, index) => {
    const code = character.charCodeAt(0);
    const symbol = code >= 32 && code <= 126 ? code - 32 : 0;
    codes.push(symbol);
    checksum += symbol * (index + 1);
  });

  codes.push(checksum % 103, STOP);

  const widths: number[] = [];
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0]!;
    for (const digit of pattern) widths.push(Number(digit));
  }
  return widths;
}
