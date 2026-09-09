import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@jecks/db';
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  ProductStatus,
  REQUIRED_IMPORT_COLUMNS,
  slugify,
  type ImportIssue,
  type ImportReport,
  type ProductImportOptions,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RollupsService } from './rollups.service.js';

/**
 * Bulk product import from CSV or XLSX — PRD F-AD-10.
 *
 * One row is one variant, addressed by SKU. Rows sharing a slug become one product with
 * several variants, which is how a spreadsheet naturally describes "black S, black M,
 * white S".
 *
 * The import defaults to a dry run. An operator uploads, reads the validation report,
 * fixes the file, and only then commits — the alternative is discovering on the
 * storefront that column F held dinars where the file meant centimes.
 */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollups: RollupsService,
  ) {}

  async run(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    options: ProductImportOptions,
  ): Promise<ImportReport> {
    const rows = await this.parse(file);

    const report: ImportReport = {
      fileName: file.originalname,
      dryRun: options.dryRun,
      totalRows: rows.length,
      productsCreated: 0,
      productsUpdated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      skipped: 0,
      issues: [],
    };

    if (rows.length === 0) {
      report.issues.push({ row: 1, column: null, message: 'The file has no data rows' });
      return report;
    }
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException({
        code: 'IMPORT_TOO_LARGE',
        message: `That file has ${rows.length} rows. Split it into files of ${IMPORT_MAX_ROWS} or fewer.`,
      });
    }

    const lookups = await this.loadLookups(rows);
    const parsed: ParsedRow[] = [];

    for (const [index, raw] of rows.entries()) {
      // Row 1 is the header, so the first data row is row 2 in the operator's file.
      const rowNumber = index + 2;
      const issues: ImportIssue[] = [];
      const row = this.validate(raw, rowNumber, lookups, issues);

      report.issues.push(...issues);
      if (row) parsed.push(row);
      else report.skipped += 1;
    }

    // A SKU repeated inside one file would create then immediately update the same
    // variant, which reads as success while losing the earlier row's values.
    const seen = new Set<string>();
    const deduped: ParsedRow[] = [];
    for (const row of parsed) {
      const key = row.sku.toLowerCase();
      if (seen.has(key)) {
        report.issues.push({
          row: row.rowNumber,
          column: 'sku',
          message: `SKU "${row.sku}" appears more than once in this file`,
        });
        report.skipped += 1;
        continue;
      }
      seen.add(key);
      deduped.push(row);
    }

    if (options.dryRun) {
      const projection = await this.project(deduped, options);
      return { ...report, ...projection };
    }

    const applied = await this.apply(deduped, options, report);
    return applied;
  }

  /** The header row an operator can download, fill in and upload back. */
  templateRows(): string[][] {
    return [
      [...IMPORT_COLUMNS],
      [
        'JECK-TRK-BLK-M',
        'Casquette trucker noire',
        'قبعة سائق شاحنة سوداء',
        'Black trucker cap',
        'casquette-trucker-noire',
        'ACTIVE',
        'jecks',
        'truckers',
        'nouveaute,coton',
        '2900',
        '3900',
        '1450',
        '120',
        '6130000000017',
        'Coton lavé, visière plate',
        'Une trucker en coton lavé, maille filet à l’arrière.',
      ],
    ];
  }

  // --- parsing --------------------------------------------------------------

  private async parse(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
  }): Promise<Array<Record<string, string>>> {
    const isExcel =
      file.originalname.toLowerCase().endsWith('.xlsx') ||
      file.mimetype.includes('spreadsheetml') ||
      file.mimetype.includes('ms-excel');

    const table = isExcel ? await readXlsx(file.buffer) : readCsv(file.buffer.toString('utf8'));
    const header = table.shift();

    if (!header) {
      throw new BadRequestException({
        code: 'EMPTY_FILE',
        message: 'That file is empty',
      });
    }

    const columns = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !columns.includes(column));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'MISSING_COLUMNS',
        message: `The file is missing the column(s): ${missing.join(', ')}`,
        details: { expected: IMPORT_COLUMNS, received: columns },
      });
    }

    return table
      .filter((cells) => cells.some((cell) => cell.trim() !== ''))
      .map((cells) =>
        Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? '').trim()])),
      );
  }

  private validate(
    raw: Record<string, string>,
    rowNumber: number,
    lookups: Lookups,
    issues: ImportIssue[],
  ): ParsedRow | null {
    const before = issues.length;
    const fail = (column: string | null, message: string) =>
      issues.push({ row: rowNumber, column, message });

    const sku = raw.sku ?? '';
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(sku)) {
      fail('sku', 'A SKU is 2 to 64 letters, digits, dots, dashes or underscores');
    }

    const nameFr = raw.name_fr ?? '';
    if (nameFr.length < 1) fail('name_fr', 'The French name is required');

    const price = parseAmount(raw.price ?? '');
    if (price === null) fail('price', 'Price must be a number of dinars, e.g. 2900 or 2900.50');

    const compareAt = raw.compare_at_price ? parseAmount(raw.compare_at_price) : null;
    if (raw.compare_at_price && compareAt === null) {
      fail('compare_at_price', 'Compare-at price must be a number of dinars');
    }
    if (price !== null && compareAt !== null && compareAt <= price) {
      fail('compare_at_price', 'Compare-at price must be higher than the selling price');
    }

    const cost = raw.cost_price ? parseAmount(raw.cost_price) : 0n;
    if (raw.cost_price && cost === null) {
      fail('cost_price', 'Cost price must be a number of dinars');
    }

    const weight = raw.weight_grams ? Number(raw.weight_grams) : 0;
    if (!Number.isInteger(weight) || weight < 0 || weight > 50_000) {
      fail('weight_grams', 'Weight is a whole number of grams between 0 and 50000');
    }

    const status = (raw.status || ProductStatus.DRAFT).toUpperCase();
    if (!Object.values(ProductStatus).includes(status as ProductStatus)) {
      fail('status', `Status must be one of ${Object.values(ProductStatus).join(', ')}`);
    }

    const slug = raw.slug ? slugify(raw.slug) : slugify(nameFr);
    if (!slug) fail('slug', 'Could not derive a slug; give one explicitly');

    let brandId: string | null = null;
    if (raw.brand) {
      brandId = lookups.brands.get(slugify(raw.brand)) ?? null;
      if (!brandId) fail('brand', `No brand has the slug "${slugify(raw.brand)}"`);
    }

    let categoryId: string | null = null;
    if (raw.category) {
      categoryId = lookups.categories.get(slugify(raw.category)) ?? null;
      if (!categoryId) fail('category', `No category has the slug "${slugify(raw.category)}"`);
    }

    const tagIds: string[] = [];
    for (const tag of splitTags(raw.tags ?? '')) {
      const tagId = lookups.tags.get(slugify(tag));
      if (tagId) tagIds.push(tagId);
      else fail('tags', `No tag has the slug "${slugify(tag)}"`);
    }

    if (issues.length > before) return null;

    return {
      rowNumber,
      sku,
      slug,
      status: status as ProductStatus,
      name: {
        fr: nameFr,
        ...(raw.name_ar ? { ar: raw.name_ar } : {}),
        ...(raw.name_en ? { en: raw.name_en } : {}),
      },
      shortDescription: raw.short_description_fr ? { fr: raw.short_description_fr } : null,
      description: raw.description_fr ? { fr: raw.description_fr } : null,
      brandId,
      categoryId,
      tagIds,
      barcode: raw.barcode || null,
      price: price!,
      compareAtPrice: compareAt,
      costPrice: cost ?? 0n,
      weightGrams: weight,
    };
  }

  // --- planning and writing -------------------------------------------------

  /** Counts what a real run would do, touching nothing. */
  private async project(rows: ParsedRow[], options: ProductImportOptions) {
    const existingSkus = await this.existingSkus(rows);
    const existingSlugs = await this.existingSlugs(rows);

    let productsCreated = 0;
    let productsUpdated = 0;
    let variantsCreated = 0;
    let variantsUpdated = 0;
    let skipped = 0;

    const plannedSlugs = new Set<string>();

    for (const row of rows) {
      const skuExists = existingSkus.has(row.sku.toLowerCase());

      if (skuExists) {
        if (options.updateExisting) {
          variantsUpdated += 1;
          productsUpdated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      variantsCreated += 1;
      if (existingSlugs.has(row.slug)) productsUpdated += 1;
      else if (!plannedSlugs.has(row.slug)) {
        productsCreated += 1;
        plannedSlugs.add(row.slug);
      }
    }

    return { productsCreated, productsUpdated, variantsCreated, variantsUpdated, skipped };
  }

  private async apply(
    rows: ParsedRow[],
    options: ProductImportOptions,
    base: ImportReport,
  ): Promise<ImportReport> {
    const report = { ...base };
    const touchedProducts = new Set<string>();

    for (const row of rows) {
      try {
        const outcome = await this.applyRow(row, options);
        if (outcome.productId) touchedProducts.add(outcome.productId);
        report.productsCreated += outcome.productCreated ? 1 : 0;
        report.productsUpdated += outcome.productUpdated ? 1 : 0;
        report.variantsCreated += outcome.variantCreated ? 1 : 0;
        report.variantsUpdated += outcome.variantUpdated ? 1 : 0;
        report.skipped += outcome.skipped ? 1 : 0;
      } catch (error) {
        // One bad row must not lose the rest of the file; it is reported and skipped.
        report.skipped += 1;
        report.issues.push({
          row: row.rowNumber,
          column: null,
          message: error instanceof Error ? error.message : 'That row could not be imported',
        });
      }
    }

    await this.rollups.refreshProducts([...touchedProducts]);
    return report;
  }

  private async applyRow(row: ParsedRow, options: ProductImportOptions) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.variant.findUnique({
        where: { sku: row.sku },
        select: { id: true, productId: true },
      });

      if (variant) {
        if (!options.updateExisting) {
          return { skipped: true, productId: variant.productId };
        }

        await tx.variant.update({
          where: { id: variant.id },
          data: {
            barcode: row.barcode,
            price: row.price,
            compareAtPrice: row.compareAtPrice,
            costPrice: row.costPrice,
            weightGrams: row.weightGrams,
          },
        });
        await this.writeProductFields(tx, variant.productId, row);

        return {
          variantUpdated: true,
          productUpdated: true,
          productId: variant.productId,
        };
      }

      const product = await tx.product.findUnique({
        where: { slug: row.slug },
        select: { id: true },
      });

      if (product) {
        const last = await tx.variant.findFirst({
          where: { productId: product.id },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        await tx.variant.create({
          data: {
            productId: product.id,
            sku: row.sku,
            barcode: row.barcode,
            price: row.price,
            compareAtPrice: row.compareAtPrice,
            costPrice: row.costPrice,
            weightGrams: row.weightGrams,
            position: (last?.position ?? -1) + 1,
          },
        });
        await this.writeProductFields(tx, product.id, row);

        return { variantCreated: true, productUpdated: true, productId: product.id };
      }

      const created = await tx.product.create({
        data: {
          name: row.name as Prisma.InputJsonValue,
          slug: row.slug,
          status: row.status,
          publishedAt: row.status === ProductStatus.ACTIVE ? new Date() : null,
          brandId: row.brandId,
          categoryId: row.categoryId,
          shortDescription: (row.shortDescription ?? undefined) as
            Prisma.InputJsonValue | undefined,
          description: (row.description ?? undefined) as Prisma.InputJsonValue | undefined,
          variants: {
            create: {
              sku: row.sku,
              barcode: row.barcode,
              price: row.price,
              compareAtPrice: row.compareAtPrice,
              costPrice: row.costPrice,
              weightGrams: row.weightGrams,
            },
          },
          ...(row.tagIds.length > 0
            ? { tags: { create: row.tagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
        select: { id: true },
      });

      return { productCreated: true, variantCreated: true, productId: created.id };
    });
  }

  /** Only columns the file actually filled in overwrite what is already stored. */
  private async writeProductFields(
    tx: Prisma.TransactionClient,
    productId: string,
    row: ParsedRow,
  ): Promise<void> {
    await tx.product.update({
      where: { id: productId },
      data: {
        name: row.name as Prisma.InputJsonValue,
        status: row.status,
        ...(row.brandId ? { brandId: row.brandId } : {}),
        ...(row.categoryId ? { categoryId: row.categoryId } : {}),
        ...(row.shortDescription
          ? { shortDescription: row.shortDescription as Prisma.InputJsonValue }
          : {}),
        ...(row.description ? { description: row.description as Prisma.InputJsonValue } : {}),
      },
    });

    if (row.status === ProductStatus.ACTIVE) {
      await tx.product.updateMany({
        where: { id: productId, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }

    if (row.tagIds.length > 0) {
      await tx.productTag.createMany({
        data: row.tagIds.map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async loadLookups(rows: Array<Record<string, string>>): Promise<Lookups> {
    const brandSlugs = uniqueSlugs(rows.map((row) => row.brand ?? ''));
    const categorySlugs = uniqueSlugs(rows.map((row) => row.category ?? ''));
    const tagSlugs = uniqueSlugs(rows.flatMap((row) => splitTags(row.tags ?? '')));

    const [brands, categories, tags] = await Promise.all([
      this.prisma.brand.findMany({
        where: { slug: { in: brandSlugs } },
        select: { id: true, slug: true },
      }),
      this.prisma.category.findMany({
        where: { slug: { in: categorySlugs } },
        select: { id: true, slug: true },
      }),
      this.prisma.tag.findMany({
        where: { slug: { in: tagSlugs } },
        select: { id: true, slug: true },
      }),
    ]);

    return {
      brands: new Map(brands.map((brand) => [brand.slug, brand.id])),
      categories: new Map(categories.map((category) => [category.slug, category.id])),
      tags: new Map(tags.map((tag) => [tag.slug, tag.id])),
    };
  }

  private async existingSkus(rows: ParsedRow[]): Promise<Set<string>> {
    const found = await this.prisma.variant.findMany({
      where: { sku: { in: rows.map((row) => row.sku) } },
      select: { sku: true },
    });
    return new Set(found.map((variant) => variant.sku.toLowerCase()));
  }

  private async existingSlugs(rows: ParsedRow[]): Promise<Set<string>> {
    const found = await this.prisma.product.findMany({
      where: { slug: { in: rows.map((row) => row.slug) } },
      select: { slug: true },
    });
    return new Set(found.map((product) => product.slug));
  }
}

interface Lookups {
  brands: Map<string, string>;
  categories: Map<string, string>;
  tags: Map<string, string>;
}

interface ParsedRow {
  rowNumber: number;
  sku: string;
  slug: string;
  status: ProductStatus;
  name: Record<string, string>;
  shortDescription: Record<string, string> | null;
  description: Record<string, string> | null;
  brandId: string | null;
  categoryId: string | null;
  tagIds: string[];
  barcode: string | null;
  price: bigint;
  compareAtPrice: bigint | null;
  costPrice: bigint;
  weightGrams: number;
}

/**
 * Dinars in, centimes out. Operators type "2 900", "2900,50" and "2900.50"; all three
 * mean the same price, and none of them may reach the database as a float.
 */
export function parseAmount(raw: string): bigint | null {
  // Separators are escaped, not typed: a figure pasted out of Excel carries U+00A0 or
  // U+202F between the thousands, and a literal one here would be invisible.
  const cleaned = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole = '0', fraction = ''] = cleaned.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueSlugs(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map((value) => slugify(value)))];
}

/**
 * A CSV reader that handles quoted fields, embedded commas and doubled quotes. Small
 * enough to own; a dependency for this would be a dependency to keep patched forever.
 */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Excel writes a BOM; leaving it in would make the first header cell unmatchable.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    // `values` is 1-based with a leading hole, which is why the slice is not optional.
    const values = (row.values as unknown[]).slice(1);
    for (const value of values) cells.push(cellText(value));
    rows.push(cells);
  });

  return rows;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof rich.text === 'string') return rich.text;
    if (rich.richText) return rich.richText.map((part) => part.text).join('');
    if (rich.result !== undefined) return String(rich.result);
    return '';
  }
  return String(value);
}

export const __importInternals = { parseAmount, readCsv, splitTags };
