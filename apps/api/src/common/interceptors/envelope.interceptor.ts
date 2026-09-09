import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful response in the `{ data, meta }` envelope of PRD Section 10.3
 * and turns BigInt money into decimal strings, because JSON has no bigint.
 *
 * A handler that already returns `{ data, meta }` is passed through unchanged, so a
 * paginated endpoint can supply its own meta.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
