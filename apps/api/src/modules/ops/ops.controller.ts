import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, RawResponse, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard.js';
import { NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { MetricsService } from './metrics.service.js';
import { QueuesService, type QueueName } from './queues.service.js';

/**
 * Operations — PRD Section 10.5.
 *
 * `/metrics` is guarded by the internal token rather than by a session: Prometheus has
 * no user, and the numbers say how many orders a shop takes, which is not public.
 */
@ApiTags('ops')
@Controller()
export class OpsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly queues: QueuesService,
  ) {}

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @RawResponse()
  @Get('metrics')
  @ApiExcludeEndpoint()
  async scrape(@Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.send(await this.metrics.render());
  }

  @Get('admin/ops/queues')
  @NoAudit()
  @ApiBearerAuth()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Queue depths and the most recent failures' })
  async queueState() {
    const [counts, failures] = await Promise.all([this.queues.counts(), this.queues.failures(25)]);
    return { ...counts, failures };
  }

  @Post('admin/ops/queues/retry')
  @ApiBearerAuth()
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Put a failed job back on its queue' })
  async retry(@Body('queue') queue: QueueName, @Body('jobId') jobId: string) {
    const ok = await this.queues.retry(queue, jobId);
    return { retried: ok };
  }
}
