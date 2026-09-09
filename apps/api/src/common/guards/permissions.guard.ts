import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@jecks/shared';
import { PERMISSIONS_KEY, type RequestWithUser } from '../decorators/auth.decorators.js';

/**
 * Enforces the permission strings of PRD Section 10.3 and acceptance criterion 6:
 * an order agent cannot reach finance, a driver only sees their own run.
 *
 * Runs after JwtAuthGuard, so a missing principal here means the route is public but
 * still declares permissions — treated as a denial rather than an accidental pass.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const granted = new Set(request.user?.permissions ?? []);
    const missing = required.filter((permission) => !granted.has(permission));

    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this area',
        details: { missing },
      });
    }
    return true;
  }
}
