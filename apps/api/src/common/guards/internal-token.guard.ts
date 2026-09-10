import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the endpoints only another of our own processes may call.
 *
 * The worker has no user and no session, so it carries a shared token instead. This is
 * not a substitute for the permission system: it protects a handful of internal routes
 * that do work on the system's behalf, never anything that acts for a person.
 *
 * When `INTERNAL_API_TOKEN` is unset the guard refuses everything. A deployment that
 * forgot to set it should lose the polling job, not open an unauthenticated door.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!expected) {
      throw new UnauthorizedException({
        code: 'INTERNAL_DISABLED',
        message: 'Internal access is not configured',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-internal-token'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException({
        code: 'INTERNAL_FORBIDDEN',
        message: 'Invalid internal token',
      });
    }

    return true;
  }
}

/** Length is compared first because `timingSafeEqual` throws on a mismatch. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
