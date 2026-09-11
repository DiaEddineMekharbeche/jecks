import { Module } from '@nestjs/common';
import { LogErrorReporter, SentryErrorReporter } from './error-reporter.js';
import { MetricsService } from './metrics.service.js';
import { OpsController } from './ops.controller.js';
import { QueuesService } from './queues.service.js';

/**
 * Metrics, queue visibility and error reporting — PRD Section 10.5.
 *
 * Global-ish by export rather than by decorator: the exception filter needs the
 * reporter, and the correlation interceptor needs the metrics recorder.
 */
@Module({
  controllers: [OpsController],
  providers: [MetricsService, QueuesService, LogErrorReporter, SentryErrorReporter],
  exports: [MetricsService, QueuesService, LogErrorReporter, SentryErrorReporter],
})
export class OpsModule {}
