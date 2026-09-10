import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators.js';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard.js';
import { NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { MaintenanceService } from './maintenance.service.js';

/**
 * The nightly work, triggered by the worker — PRD F-AD-40, F-AD-71 and Section 6.5.
 *
 * The worker owns the clock and the API owns the rules, the same split courier polling
 * made in M4. Segmentation thresholds, the loyalty policy and the recurrence maths all
 * live beside the database; duplicating them in the worker would mean two answers to
 * the same question.
 *
 * Guarded by the shared internal token, and unavailable when that is unset.
 */
@ApiTags('internal')
@ApiExcludeController()
@Controller('internal/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @Post('recurring-expenses')
  recurringExpenses() {
    return this.maintenance.generateRecurringExpenses();
  }

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @Post('segments')
  segments(@Body('limit') limit?: number) {
    return this.maintenance.refreshSegments(limit && limit > 0 ? Math.min(limit, 20_000) : 5_000);
  }

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @Post('loyalty-expiry')
  loyaltyExpiry() {
    return this.maintenance.expireLoyalty();
  }
}
