import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestWithUser } from '../decorators/auth.decorators.js';

export const AUDIT_SKIP_KEY = 'jecks:auditSkip';
export const AUDIT_ENTITY_KEY = 'jecks:auditEntity';

/** Opts a mutating admin route out of the audit log — use for high-volume noise. */
export const NoAudit = (): MethodDecorator & ClassDecorator => SetMetadata(AUDIT_SKIP_KEY, true);

/** Names the entity a controller writes, so the log reads "product" not "products". */
export const AuditEntity = (entity: string): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIT_ENTITY_KEY, entity);

/** Keys whose values must never reach the audit table — PRD Section 10.8. */
const REDACTED = [
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'twofactorsecret',
  'totp',
  'code',
  'apikey',
  'valueenc',
  'credentials',
];

/**
 * Writes an `AuditLog` row for every successful mutating request under `/admin`
 * — PRD F-AD-93.
 *
 * Registered globally, so a new admin module is audited the moment it exists rather
 * than when someone remembers to add a decorator. Reads are ignored: logging every
 * list request would bury the changes that matter.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const isAdmin = request.originalUrl?.includes('/admin/');
    const skip = this.reflector.getAllAndOverride<boolean>(AUDIT_SKIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isMutation || !isAdmin || skip) return next.handle();

    const entity =
      this.reflector.getAllAndOverride<string>(AUDIT_ENTITY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? entityFromUrl(request.originalUrl);

    return next.handle().pipe(
      tap((result) => {
        // Fire and forget: an audit write must never fail the request that caused it.
        void this.record(request, entity, result).catch((error: unknown) => {
          this.logger.error(`Failed to write audit log: ${String(error)}`);
        });
      }),
    );
  }

  private async record(
    request: RequestWithUser,
    entityType: string,
    result: unknown,
  ): Promise<void> {
    const user = request.user;
    const body = request.body as Record<string, unknown> | undefined;
    const entityId = extractId(result) ?? (request.params as Record<string, string>)?.id ?? null;

    await this.prisma.auditLog.create({
      data: {
        actorId: user?.id ?? null,
        actorLabel: user ? `${user.name}${user.email ? ` <${user.email}>` : ''}` : 'system',
        action: `${request.method} ${routePattern(request.originalUrl)}`,
        entityType,
        entityId: entityId ? String(entityId).slice(0, 64) : null,
        // The submitted payload is the "after"; a per-module before/after diff is
        // recorded by the services that read the row first (see OrderService).
        changes: redact(body) as never,
        ip: request.ip?.slice(0, 64) ?? null,
        userAgent: request.headers['user-agent']?.slice(0, 400) ?? null,
      },
    });
  }
}

/** `/api/v1/admin/products/abc` -> `product`. */
function entityFromUrl(url = ''): string {
  const match = /\/admin\/([a-z-]+)/.exec(url);
  const plural = match?.[1] ?? 'unknown';
  return plural.endsWith('s') ? plural.slice(0, -1) : plural;
}

/** Collapses ids out of the path so the action groups across records. */
function routePattern(url = ''): string {
  return url
    .split('?')[0]!
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:n');
}

function extractId(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  const data = record.data as Record<string, unknown> | undefined;
  return typeof data?.id === 'string' ? data.id : null;
}

/** Deep-copies a payload, replacing secret values and trimming very long strings. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }

  if (typeof value === 'bigint') return value.toString();

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED.includes(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }

  return value;
}

export const __auditInternals = { redact, entityFromUrl, routePattern, extractId };
