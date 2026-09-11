import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  REPORT_KEYS,
  adminListQuerySchema,
  adSpendInputSchema,
  expenseCategoryInputSchema,
  expenseInputSchema,
  ledgerEntryInputSchema,
  pnlQuerySchema,
  reportExportRequestSchema,
  reportQuerySchema,
  type AdSpendInput,
  type AdminListQuery,
  type ExpenseCategoryInput,
  type ExpenseInput,
  type LedgerEntryInput,
  type PnlQuery,
  type ReportExportRequest,
  type ReportKey,
  type ReportQuery,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  Public,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { EXPENSE_EXPORT_COLUMNS, ExpensesService } from './expenses.service.js';
import { LEDGER_EXPORT_COLUMNS, LedgerService } from './ledger.service.js';
import { PNL_EXPORT_COLUMNS, PnlService } from './pnl.service.js';
import { ReportExportsService } from './report-exports.service.js';
import { ReportsService, exportBaseName } from './reports.service.js';

@ApiTags('admin/finance')
@ApiBearerAuth()
@AuditEntity('expense')
@Controller('admin/finance/expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Expenses, with the filtered total' })
  @ApiQuery({ name: 'filter[categoryId]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.expenses.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'depenses', EXPENSE_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.expenses.list(query, filters));
  }

  @Get('categories')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Expense categories with their totals' })
  categories() {
    return this.expenses.listCategories();
  }

  @Post('categories')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Create a category' })
  createCategory(@Body(zod(expenseCategoryInputSchema)) body: ExpenseCategoryInput) {
    return this.expenses.createCategory(body);
  }

  @Patch('categories/:id')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Update a category' })
  updateCategory(
    @Param('id') id: string,
    @Body(zod(expenseCategoryInputSchema)) body: ExpenseCategoryInput,
  ) {
    return this.expenses.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Delete a category nothing is filed under' })
  async removeCategory(@Param('id') id: string): Promise<void> {
    await this.expenses.removeCategory(id);
  }

  @Post()
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Record an expense' })
  create(@Body(zod(expenseInputSchema)) body: ExpenseInput, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.create(body, user.id);
  }

  @Patch(':id')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Update an expense' })
  update(@Param('id') id: string, @Body(zod(expenseInputSchema)) body: ExpenseInput) {
    return this.expenses.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Archive an expense; past periods keep it' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.expenses.remove(id);
  }

  @Post('generate-recurring')
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Generate the occurrences a series owes, up to today' })
  generate() {
    return this.expenses.generateRecurring();
  }
}

@ApiTags('admin/finance')
@ApiBearerAuth()
@AuditEntity('ad_spend')
@Controller('admin/finance/ad-spend')
export class AdSpendController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Ad spend rows for a period' })
  list(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = periodOf(from, to);
    return this.ledger.listAdSpend(start, end);
  }

  @Get('summary')
  @NoAudit()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Spend against revenue, with ROAS and cost per order' })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    const { start, end } = periodOf(from, to);
    return this.ledger.adSpendSummary(start, end);
  }

  @Post()
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Record a day of spend; the same day replaces rather than adds' })
  save(@Body(zod(adSpendInputSchema)) body: AdSpendInput) {
    return this.ledger.saveAdSpend(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Delete a spend row' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.ledger.removeAdSpend(id);
  }
}

@ApiTags('admin/finance')
@ApiBearerAuth()
@AuditEntity('ledger_entry')
@Controller('admin/finance/ledger')
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Every movement of money, newest first' })
  @ApiQuery({ name: 'filter[account]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.ledger.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'journal-caisse', LEDGER_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.ledger.list(query, filters));
  }

  @Get('balances')
  @NoAudit()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Balance per account, derived from the entries' })
  balances() {
    return this.ledger.balances();
  }

  @Post()
  @RequirePermissions('finance.write')
  @ApiOperation({ summary: 'Record a movement no automatic hook can see' })
  create(@Body(zod(ledgerEntryInputSchema)) body: LedgerEntryInput) {
    return this.ledger.create(body);
  }
}

@ApiTags('admin/finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class PnlController {
  constructor(
    private readonly pnl: PnlService,
    private readonly exporter: ExportService,
  ) {}

  /**
   * The profit and loss — PRD F-AD-70.
   *
   * `@NoAudit` because reading a report changes nothing, and an owner who checks their
   * margin six times a day would otherwise bury every write in the journal.
   */
  @Get('pnl')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Profit and loss for a period, grouped and optionally compared' })
  async report(
    @Query(zod(pnlQuerySchema)) query: PnlQuery,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.pnl.report(query);

    if (query.format) {
      await this.exporter.stream(response, query.format, 'resultat', PNL_EXPORT_COLUMNS, report.rows);
      return;
    }

    response.json({ data: report });
  }
}

@ApiTags('admin/reports')
@ApiBearerAuth()
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
    private readonly exports: ReportExportsService,
  ) {}

  @Get()
  @NoAudit()
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Every report the library offers' })
  catalogue() {
    return this.reports.catalogue();
  }

  @Get('exports')
  @NoAudit()
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Recent queued exports, newest first' })
  listExports() {
    return this.exports.list();
  }

  @Get('exports/:id')
  @NoAudit()
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'One export, for polling while it runs' })
  getExport(@Param('id') id: string) {
    return this.exports.get(id);
  }

  @Post(':key/exports')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Queue an export too large to wait for in the browser' })
  queueExport(
    @Param('key') key: string,
    @Body(zod(reportExportRequestSchema)) body: ReportExportRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!(REPORT_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException({
        code: 'UNKNOWN_REPORT',
        message: `Rapport inconnu : ${key}`,
      });
    }
    return this.exports.queueExport(key as ReportKey, body, user.id);
  }

  @Get(':key')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Run one report; add a format to stream it as a file' })
  async run(
    @Param('key') key: string,
    @Query(zod(reportQuerySchema)) query: ReportQuery,
    @Res() response: Response,
  ): Promise<void> {
    if (!(REPORT_KEYS as readonly string[]).includes(key)) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: { code: 'UNKNOWN_REPORT', message: `Rapport inconnu : ${key}` },
      });
      return;
    }

    const result = await this.reports.run(key as ReportKey, query);

    if (query.format) {
      // The columns come from the report itself, so a new report exports without any
      // change here.
      const columns = result.columns.map((column) => ({
        header: column.label,
        value: (row: Record<string, string | number | null>) => row[column.key] ?? '',
      }));
      await this.exporter.stream(response, query.format, exportBaseName(key), columns, result.rows);
      return;
    }

    response.json({ data: result });
  }
}

/**
 * The export runner, called by the worker — PRD Section 6.5.
 *
 * Same split as courier polling and the nightly maintenance: the worker owns the queue
 * slot and the retry, the API owns the query, because the report lives here and running
 * it from two places would be two answers to one question.
 */
@ApiTags('internal')
@ApiExcludeController()
@Controller('internal/reports')
export class InternalReportsController {
  constructor(private readonly exports: ReportExportsService) {}

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @Post('export')
  run(@Body('jobId') jobId: string) {
    return this.exports.run(jobId);
  }
}

/** A period from two optional dates, defaulting to the last thirty days. */
function periodOf(from?: string, to?: string): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 86_400_000);
  return { start, end };
}
