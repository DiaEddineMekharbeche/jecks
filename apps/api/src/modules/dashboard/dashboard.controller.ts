import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { DashboardService } from './dashboard.service.js';

const querySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).default('30d'),
});

@ApiTags('admin/dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'KPI tiles, trend series and the needs-attention counters' })
  summary(@Query(zod(querySchema)) query: z.infer<typeof querySchema>) {
    return this.dashboard.summary(query.period);
  }
}
