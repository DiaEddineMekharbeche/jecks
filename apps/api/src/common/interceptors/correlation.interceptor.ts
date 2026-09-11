import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { RequestWithUser } from '../decorators/auth.decorators.js';
import { MetricsService } from '../../modules/ops/metrics.service.js';

/**
 * Correlation id plus a one-line access log — PRD Section 11 (observability).
 * The id is echoed in the `x-correlation-id` header and in every error envelope, so a
 * support message quoting it can be traced to a single request.
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const response = http.getResponse<Response>();

    const incoming = request.headers['x-correlation-id'];
    const correlationId = (typeof incoming === 'string' && incoming.slice(0, 64)) || nanoid(12);
    request.correlationId = correlationId;
    // A streaming route may already have flushed its headers by the time a retry
    // reaches here; setting one then throws and kills the stream.
    if (!response.headersSent) response.setHeader('x-correlation-id', correlationId);

    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.finish(request, response.statusCode, started, correlationId),
        error: () => this.finish(request, response.statusCode, started, correlationId),
      }),
    );
  }

  private finish(
    request: RequestWithUser,
    status: number,
    started: number,
    correlationId: string,
  ): void {
    const durationMs = Date.now() - started;
    const actor = request.user ? `${request.user.type.toLowerCase()}:${request.user.id}` : 'guest';

    this.logger.log(
      `${request.method} ${request.originalUrl} ${status} ${durationMs}ms ${actor} ${correlationId}`,
    );

    // The route template, not the path: one series per endpoint rather than one per
    // order id, which is how a metrics endpoint takes a server down.
    this.metrics.record({
      method: request.method,
      route: routeOf(request),
      status,
      durationMs,
    });
  }
}

/**
 * The route pattern Nest matched, falling back to the path with ids masked.
 *
 * Express records the matched layer on the request; when it has not (a 404, a stream
 * that bypassed the router) the path is normalised by hand so one missing template
 * cannot create a metric series per order.
 */
function routeOf(request: RequestWithUser): string {
  const matched = (request as { route?: { path?: string } }).route?.path;
  if (matched) return matched;

  return request.path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
    .replace(/\/\d+/g, '/:n');
}
