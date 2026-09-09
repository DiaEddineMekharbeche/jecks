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

/**
 * Correlation id plus a one-line access log — PRD Section 11 (observability).
 * The id is echoed in the `x-correlation-id` header and in every error envelope, so a
 * support message quoting it can be traced to a single request.
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

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
        next: () => this.log(request, response.statusCode, started, correlationId),
        error: () => this.log(request, response.statusCode, started, correlationId),
      }),
    );
  }

  private log(
    request: RequestWithUser,
    status: number,
    started: number,
    correlationId: string,
  ): void {
    const actor = request.user ? `${request.user.type.toLowerCase()}:${request.user.id}` : 'guest';
    this.logger.log(
      `${request.method} ${request.originalUrl} ${status} ${Date.now() - started}ms ${actor} ${correlationId}`,
    );
  }
}
