import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/auth.decorators.js';

/**
 * Wraps every successful response in the `{ data, meta }` envelope of PRD Section 10.3
 * and turns BigInt money into decimal strings, because JSON has no bigint.
 *
 * A handler that already returns `{ data, meta }` is passed through unchanged, so a
 * paginated endpoint can supply its own meta. A route marked `@RawResponse()` — an SSE
 * stream, a PDF, a CSV — is left entirely alone: wrapping those corrupts them.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((payload) => {
        if (payload === undefined || payload === null) return { data: null };
        if (isEnvelope(payload)) return serialize(payload);
        return serialize({ data: payload });
      }),
    );
  }
}

function isEnvelope(value: unknown): value is { data: unknown; meta?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Object.keys(value).every((key) => key === 'data' || key === 'meta')
  );
}

/** Deep clone that renders BigInt as a string and Date as an ISO instant. */
function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as T;
}
