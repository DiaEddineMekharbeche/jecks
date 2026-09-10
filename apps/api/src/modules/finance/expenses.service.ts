import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  FINANCE_ERRORS,
  type AdminListQuery,
  type ExpenseCategoryDto,
  type ExpenseCategoryInput,
  type ExpenseInput,
  type ExpenseRecurrence,
  type ExpenseRow,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { occurrencesBetween } from './domain/recurrence.js';

/**
 * Expenses — PRD F-AD-71.
 *
 * Rent, salaries, packaging and everything else that is not the cost of a cap. A
 * recurring expense is stored once as a parent and generated forward by the worker, so
 * changing the rent changes the future without rewriting history.
 */
@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // --- categories -----------------------------------------------------------

  async listCategories(): Promise<ExpenseCategoryDto[]> {
    const categories = await this.prisma.expenseCategory.findMany({
      orderBy: { slug: 'asc' },
      include: { _count: { select: { expenses: true } } },
    });

    const totals = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null },
      _sum: { amount: true },
    });
    const byCategory = new Map(totals.map((row) => [row.categoryId, row._sum.amount ?? 0n]));

    return categories.map((category) => ({
      id: category.id,
      name: category.name as Translated,
      slug: category.slug,
      color: category.color,
      expenseCount: category._count.expenses,
      totalMinor: (byCategory.get(category.id) ?? 0n).toString(),
    }));
  }

  async createCategory(input: ExpenseCategoryInput): Promise<ExpenseCategoryDto> {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new BadRequestException({
        code: 'SLUG_TAKEN',
        message: 'A category already uses that slug',
        details: { field: 'slug' },
      });
    }

    const category = await this.prisma.expenseCategory.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        color: input.color ?? null,
      },
    });

    return {
      id: category.id,
      name: category.name as Translated,
      slug: category.slug,
      color: category.color,
      expenseCount: 0,
      totalMinor: '0',
    };
  }

  async updateCategory(id: string, input: ExpenseCategoryInput): Promise<ExpenseCategoryDto> {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Category not found' });

    const category = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        color: input.color ?? null,
      },
      include: { _count: { select: { expenses: true } } },
    });

    return {
      id: category.id,
      name: category.name as Translated,
      slug: category.slug,
      color: category.color,
      expenseCount: category._count.expenses,
      totalMinor: '0',
    };
  }

  /**
   * Deletes a category only while nothing is filed under it.
   *
   * The relation would null the field silently, and a P&L that quietly moves last
   * year's rent into "uncategorised" is a P&L nobody trusts again.
   */
  async removeCategory(id: string): Promise<void> {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!category) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Category not found' });

    if (category._count.expenses > 0) {
      throw new BadRequestException({
        code: FINANCE_ERRORS.CATEGORY_IN_USE,
        message: `${category._count.expenses} dépense(s) sont classées ici. Reclassez-les d’abord.`,
      });
    }

    await this.prisma.expenseCategory.delete({ where: { id } });
  }

  // --- expenses -------------------------------------------------------------

  async list(query: AdminListQuery, filters: Record<string, string[]>) {
    const where = this.whereFrom(query, filters);

    const [rows, total, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { [query.sort ?? 'incurredAt']: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: this.rowInclude(),
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      data: rows.map((row) => this.toRow(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        // The list is also a total; scrolling to add up a filtered set is not a feature.
        totalAmountMinor: (sum._sum.amount ?? 0n).toString(),
      },
    };
  }

  async listForExport(query: AdminListQuery, filters: Record<string, string[]>) {
    const rows = await this.prisma.expense.findMany({
      where: this.whereFrom(query, filters),
      orderBy: { incurredAt: 'desc' },
      take: 50_000,
      include: this.rowInclude(),
    });
    return rows.map((row) => this.toRow(row));
  }

  async create(input: ExpenseInput, userId: string | null): Promise<ExpenseRow> {
    const expense = await this.prisma.expense.create({
      data: {
        categoryId: input.categoryId ?? null,
        label: input.label,
        amount: input.amount,
        incurredAt: startOfDay(input.incurredAt),
        recurrence: input.recurrence ?? null,
        recurrenceEndsAt: input.recurrenceEndsAt ? startOfDay(input.recurrenceEndsAt) : null,
        attachmentKey: input.attachmentKey ?? null,
        note: input.note ?? null,
        createdById: userId,
      },
      include: this.rowInclude(),
    });

    return this.toRow(expense);
  }

  async update(id: string, input: ExpenseInput): Promise<ExpenseRow> {
    const existing = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Expense not found' });

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        categoryId: input.categoryId ?? null,
        label: input.label,
        amount: input.amount,
        incurredAt: startOfDay(input.incurredAt),
        recurrence: input.recurrence ?? null,
        recurrenceEndsAt: input.recurrenceEndsAt ? startOfDay(input.recurrenceEndsAt) : null,
        attachmentKey: input.attachmentKey ?? null,
        note: input.note ?? null,
      },
      include: this.rowInclude(),
    });

    return this.toRow(expense);
  }

  /** Soft delete: a removed expense still explains a past month's profit. */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Expense not found' });

    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Generates the occurrences a recurring expense owes up to a date.
   *
   * Called by the worker monthly, and idempotent: an occurrence already written for a
   * date is left alone, so running it twice does not double the rent.
   */
  async generateRecurring(until: Date = new Date()): Promise<{ created: number }> {
    const parents = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        recurrence: { not: null },
        parentId: null,
        OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gte: new Date() } }],
      },
      select: {
        id: true,
        categoryId: true,
        label: true,
        amount: true,
        incurredAt: true,
        recurrence: true,
        recurrenceEndsAt: true,
        note: true,
        createdById: true,
      },
    });

    let created = 0;

    for (const parent of parents) {
      const existing = await this.prisma.expense.findMany({
        where: { parentId: parent.id },
        select: { incurredAt: true },
      });
      const written = new Set(existing.map((row) => row.incurredAt.toISOString().slice(0, 10)));

      for (const date of occurrencesBetween(
        parent.incurredAt,
        parent.recurrence as ExpenseRecurrence,
        until,
        parent.recurrenceEndsAt,
      )) {
        const key = date.toISOString().slice(0, 10);
        // The parent itself covers its own start date.
        if (key === parent.incurredAt.toISOString().slice(0, 10)) continue;
        if (written.has(key)) continue;

        await this.prisma.expense.create({
          data: {
            categoryId: parent.categoryId,
            label: parent.label,
            amount: parent.amount,
            incurredAt: date,
            parentId: parent.id,
            note: parent.note,
            createdById: parent.createdById,
          },
        });
        created += 1;
      }
    }

    return { created };
  }

  private whereFrom(query: AdminListQuery, filters: Record<string, string[]>): Prisma.ExpenseWhereInput {
    const search = query.q?.trim();

    return {
      deletedAt: null,
      ...(filters.categoryId?.length ? { categoryId: { in: filters.categoryId } } : {}),
      ...(filters.recurrence?.length
        ? filters.recurrence.includes('none')
          ? { recurrence: null }
          : { recurrence: { in: filters.recurrence } }
        : {}),
      ...(filters.from?.[0] || filters.to?.[0]
        ? {
            incurredAt: {
              ...(filters.from?.[0] ? { gte: new Date(filters.from[0]) } : {}),
              ...(filters.to?.[0] ? { lte: new Date(filters.to[0]) } : {}),
            },
          }
        : {}),
      ...(search ? { label: { contains: search, mode: 'insensitive' } } : {}),
    };
  }

  private rowInclude() {
    return {
      category: { select: { name: true, color: true } },
      createdBy: { select: { name: true } },
    } satisfies Prisma.ExpenseInclude;
  }

  private toRow(expense: {
    id: string;
    categoryId: string | null;
    label: string;
    amount: bigint;
    incurredAt: Date;
    recurrence: string | null;
    recurrenceEndsAt: Date | null;
    parentId: string | null;
    attachmentKey: string | null;
    note: string | null;
    createdAt: Date;
    category: { name: unknown; color: string | null } | null;
    createdBy: { name: string } | null;
  }): ExpenseRow {
    return {
      id: expense.id,
      categoryId: expense.categoryId,
      categoryName: (expense.category?.name as Translated | undefined) ?? null,
      categoryColor: expense.category?.color ?? null,
      label: expense.label,
      amountMinor: expense.amount.toString(),
      incurredAt: expense.incurredAt.toISOString().slice(0, 10),
      recurrence: (expense.recurrence as ExpenseRecurrence | null) ?? null,
      recurrenceEndsAt: expense.recurrenceEndsAt?.toISOString().slice(0, 10) ?? null,
      parentId: expense.parentId,
      attachmentKey: expense.attachmentKey,
      note: expense.note,
      createdByName: expense.createdBy?.name ?? null,
      createdAt: expense.createdAt.toISOString(),
    };
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const EXPENSE_EXPORT_COLUMNS = [
  { header: 'Date', value: (row: ExpenseRow) => row.incurredAt },
  { header: 'Libellé', value: (row: ExpenseRow) => row.label },
  { header: 'Catégorie', value: (row: ExpenseRow) => (row.categoryName?.fr ?? '') },
  { header: 'Montant (DA)', value: (row: ExpenseRow) => Number(row.amountMinor) / 100 },
  { header: 'Récurrence', value: (row: ExpenseRow) => row.recurrence ?? '' },
  { header: 'Note', value: (row: ExpenseRow) => row.note ?? '' },
];
