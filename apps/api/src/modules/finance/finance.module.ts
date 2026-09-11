import { Module } from '@nestjs/common';
import {
  AdSpendController,
  ExpensesController,
  InternalReportsController,
  LedgerController,
  PnlController,
  ReportsController,
} from './finance.controller.js';
import { ExpensesService } from './expenses.service.js';
import { LedgerService } from './ledger.service.js';
import { PnlService } from './pnl.service.js';
import { ReportExportsService } from './report-exports.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Finance and reporting — PRD F-AD-70 to F-AD-81.
 *
 * Everything here is derived from orders, expenses and ad spend. Nothing is stored
 * twice, so a report cannot disagree with the rows behind it.
 */
@Module({
  controllers: [
    ExpensesController,
    AdSpendController,
    LedgerController,
    PnlController,
    ReportsController,
    InternalReportsController,
  ],
  providers: [ExpensesService, LedgerService, PnlService, ReportsService, ReportExportsService],
  exports: [ExpensesService, LedgerService, PnlService, ReportsService, ReportExportsService],
})
export class FinanceModule {}
