import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { DashboardService, resolveWindow } from './dashboard.service.js';
import { InsightsService } from './insights.service.js';

const querySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).default('30d'),
});

@ApiTags('admin/dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly insights: InsightsService,
  ) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'KPI tiles, trend series and the needs-attention counters' })
  summary(@Query(zod(querySchema)) query: z.infer<typeof querySchema>) {
    return this.dashboard.summary(query.period);
  }

  /**
   * The heatmap, the map and the funnel — PRD F-AD-02 and F-AD-04.
   *
   * Separate from the summary because it reads the orders themselves rather than the
   * pre-aggregated day rows, and the numbers at the top should not wait for it.
   */
  @Get('insights')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Wilaya breakdown, order heatmap, funnel and recent activity' })
  insightsFor(@Query(zod(querySchema)) query: z.infer<typeof querySchema>) {
    const { from, to } = resolveWindow(query.period);
    return this.insights.insights(from, to);
  }
}
