import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ExportService, type ExportColumn } from './export.service.js';

interface Row {
  number: string;
  total: number;
  placedAt: Date;
  note: string | null;
}

const ROWS: Row[] = [
  { number: 'JK-260909-0001', total: 3500, placedAt: new Date('2026-09-09T10:00:00Z'), note: null },
  { number: 'JK-260909-0002', total: 12_600, placedAt: new Date('2026-09-09T11:00:00Z'), note: 'Alger, Centre' },
];

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Numéro', value: (row) => row.number },
  { header: 'Total (DA)', value: (row) => row.total },
  { header: 'Date', value: (row) => row.placedAt },
  { header: 'Note', value: (row) => row.note },
];

/**
 * A real writable stream wearing an Express response's header methods.
 *
 * The XLSX writer pipes into the response and waits on stream events, so a plain
 * object with `write` and `end` stubs never completes — it has to be an actual stream.
 */
function fakeResponse() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string | number>();

  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));

  Object.assign(stream, {
    setHeader: vi.fn((name: string, value: string | number) =>
      headers.set(name.toLowerCase(), value),
    ),
  });

  return {
    response: stream as unknown as Response,
    headers,
    /** Resolves once the stream has finished, so every byte is present. */
    async body(): Promise<Buffer> {
      if (!stream.writableEnded) await new Promise((done) => stream.end(done));
      await new Promise((done) => setImmediate(done));
      return Buffer.concat(chunks);
    },
  };
}

describe('ExportService — CSV', () => {
  it('writes a header row followed by one line per record', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, ROWS);

    const lines = (await body()).toString('utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Numéro,Total (DA),Date,Note');
    expect(lines[1]).toContain('JK-260909-0001');
  });

  it('starts with a byte-order mark, or Excel mangles every accent', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, ROWS);

    expect((await body()).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('quotes a value containing a comma', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, ROWS);

    expect((await body()).toString('utf8')).toContain('"Alger, Centre"');
  });

  it('renders a null as an empty field rather than the word null', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, ROWS);

    const firstRow = (await body()).toString('utf8').trim().split('\n')[1]!;
    expect(firstRow.endsWith(',')).toBe(true);
  });

  it('sets a download filename stamped with today, so files do not overwrite', async () => {
    const { response, headers } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, ROWS);

    expect(headers.get('content-type')).toContain('text/csv');
    expect(String(headers.get('content-disposition'))).toMatch(
      /attachment; filename="commandes-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  it('still writes the header when there are no rows', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'csv', 'commandes', COLUMNS, []);

    expect((await body()).toString('utf8').trim().split('\n')).toHaveLength(1);
  });
});

describe('ExportService — XLSX', () => {
  it('produces a real workbook and the spreadsheet content type', async () => {
    const { response, headers, body } = fakeResponse();
    await new ExportService().stream(response, 'xlsx', 'commandes', COLUMNS, ROWS);

    expect(String(headers.get('content-type'))).toContain('spreadsheetml');
    expect(String(headers.get('content-disposition'))).toContain('.xlsx');
    // XLSX is a ZIP container; "PK" is its signature.
    expect((await body()).subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('handles an empty export without producing a corrupt file', async () => {
    const { response, body } = fakeResponse();
    await new ExportService().stream(response, 'xlsx', 'commandes', COLUMNS, []);

    expect((await body()).subarray(0, 2).toString('ascii')).toBe('PK');
  });
});

describe('ExportService — toBuffer', () => {
  it('produces the same CSV the download does, byte-order mark included', async () => {
    const buffer = await new ExportService().toBuffer('csv', COLUMNS, ROWS);
    const text = buffer.toString('utf8');

    expect(text.charCodeAt(0)).toBe(0xfeff);
    // Header plus one line per row, and a trailing newline.
    expect(text.trim().split('\n')).toHaveLength(3);
    expect(text).toContain('JK-260909-0001');
  });

  it('quotes a cell containing a comma, so the columns do not shift', async () => {
    const buffer = await new ExportService().toBuffer('csv', COLUMNS, ROWS);

    expect(buffer.toString('utf8')).toContain('"Alger, Centre"');
  });

  it('writes an empty CSV as a header and nothing else', async () => {
    const buffer = await new ExportService().toBuffer('csv', COLUMNS, []);

    expect(buffer.toString('utf8').trim().split('\n')).toHaveLength(1);
  });

  it('produces a real workbook', async () => {
    const buffer = await new ExportService().toBuffer('xlsx', COLUMNS, ROWS);

    // XLSX is a ZIP container; "PK" is its signature.
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('produces a valid workbook for an empty export rather than a corrupt file', async () => {
    const buffer = await new ExportService().toBuffer('xlsx', COLUMNS, []);

    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('does not truncate a workbook that outgrows one stream chunk', async () => {
    // A single PassThrough chunk is 64 KB by default; a short read here would have
    // produced a file that opens as "damaged" only for large exports.
    const many = Array.from({ length: 5000 }, (_, index) => ({
      number: `JK-260909-${String(index).padStart(4, '0')}`,
      total: index * 100,
      placedAt: new Date('2026-09-09T10:00:00Z'),
      note: 'Une note assez longue pour remplir la feuille',
    }));

    const buffer = await new ExportService().toBuffer('xlsx', COLUMNS, many);

    expect(buffer.length).toBeGreaterThan(65_536);
    // The ZIP end-of-central-directory record; a truncated file has no such tail.
    expect(buffer.subarray(buffer.length - 22).indexOf(Buffer.from('PK\u0005\u0006', 'ascii'))).toBe(0);
  });
});
