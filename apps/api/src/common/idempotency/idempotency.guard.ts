import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import IORedis from 'ioredis';
import type { RequestWithUser } from '../decorators/auth.decorators.js';

export const IDEMPOTENT_KEY = 'jecks:idempotent';

/**
 * Marks a route that must not act twice on the same `Idempotency-Key`.
 *
 * Applied to order creation and to every inbound webhook — PRD Section 10.3.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT_KEY, true);

/**
 * Redis-backed in-flight lock for idempotent writes.
 *
 * It solves exactly one problem: two identical requests arriving *at the same time*.
 * The durable half — a replayed key hours later — is handled by the unique
 * `Order.idempotencyKey` column, which is the only thing that survives a Redis restart
 * and is therefore the thing that must be authoritative.
 *
 * A key is held for the length of the request and then released, so a genuine retry
 * after a failure is not refused. If Redis is unreachable the guard lets the request
 * through: the database constraint still prevents a duplicate order, and refusing every
 * checkout because a cache is down would be a far worse failure.
 */
@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);
  private readonly redis: IORedis | null;

  /** Seconds a key is held while its request runs. */
  private static readonly LOCK_TTL = 60;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    const url = config.get<string>('REDIS_URL');
    this.redis = url
      ? new IORedis(url, {
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          lazyConnect: true,
          retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
        })
      : null;

    this.redis?.on('error', (error) => {
      this.logger.warn(`Idempotency store unavailable: ${error.message}`);
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || !this.redis) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const key = headerKey(request);
    if (!key) return true;

    const lock = `idem:${createHash('sha256').update(`${request.path}:${key}`).digest('hex')}`;

    try {
      const acquired = await this.redis.set(lock, '1', 'EX', IdempotencyGuard.LOCK_TTL, 'NX');
      if (acquired === null) {
        throw new ConflictException({
          code: 'REQUEST_IN_FLIGHT',
          message: 'That request is already being processed',
        });
      }

      // Release on the way out, whichever way it goes: a failed attempt must be
      // retryable immediately rather than after a minute of waiting.
      const release = () => void this.redis?.del(lock).catch(() => undefined);
      const response = context.switchToHttp().getResponse<{ on: (event: string, cb: () => void) => void }>();
      response.on('finish', release);
      response.on('close', release);

      return true;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.warn(`Idempotency check skipped: ${String(error)}`);
      return true;
    }
  }
}

/** The header, case-insensitively, capped so a huge value cannot be used as a key. */
export function headerKey(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const raw = request.headers['idempotency-key'] ?? request.headers['Idempotency-Key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 128);
}
