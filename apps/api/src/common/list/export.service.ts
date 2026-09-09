import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';

/**
 * CSV and XLSX export for admin lists — PRD Section 5 ("all lists MUST support
 * CSV/Excel export").
 *
 * Both formats stream: a 50 000-row export must not be assembled in memory first, and
 * the operator should see the download start immediately.
 */

export interface ExportColumn<T> {
  header: string;
  /** Returns a primitive; money is expected already converted to major units. */
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
}

@Injectable()
export class ExportService {
  async stream<T>(
    response: Response,
    format: 'csv' | 'xlsx',
    filename: string,
    columns: ExportColumn<T>[],
    rows: T[],
  ): Promise<void> {
    const stamped = `${filename}-${new Date().toISOString().slice(0, 10)}`;
    return format === 'xlsx'
      ? this.streamXlsx(response, stamped, columns, rows)
      : this.streamCsv(response, stamped, columns, rows);
  }

  private streamCsv<T>(
    response: Response,
    filename: string,
    columns: ExportColumn<T>[],
    rows: T[],
  ): void {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

    // Excel on Windows reads a bare UTF-8 CSV as Latin-1 and mangles every accent and
    // every Arabic character. The byte-order mark is what makes it open correctly.
    response.write('﻿');
    response.write(`${columns.map((column) => csvCell(column.header)).join(',')}\n`);

    for (const row of rows) {
      response.write(`${columns.map((column) => csvCell(column.value(row))).join(',')}\n`);
    }
    response.end();
  }

  private async streamXlsx<T>(
    response: Response,
    filename: string,
    columns: ExportColumn<T>[],
    rows: T[],
  ): Promise<void> {
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response, useStyles: true });
    const sheet = workbook.addWorksheet('Export', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.header,
      width: column.width ?? Math.min(Math.max(column.header.length + 4, 12), 40),
    }));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(columns.map((column) => column.value(row) ?? '')).commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}

/** RFC 4180: quote when the value contains a comma, quote or newline; double quotes. */
function csvCell(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export const __exportInternals = { csvCell };
