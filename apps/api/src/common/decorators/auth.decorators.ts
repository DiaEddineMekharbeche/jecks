import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@jecks/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'jecks:isPublic';
export const PERMISSIONS_KEY = 'jecks:permissions';

/** Marks a route as reachable without a token — storefront catalog, checkout, tracking. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires every listed permission string (PRD Section 10.3). Listing more than one
 * means AND; a route needing "either of" should take the broader permission instead.
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

export interface AuthenticatedUser {
  id: string;
  type: 'STAFF' | 'CUSTOMER';
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  permissions: string[];
  sessionId: string;
}

export type RequestWithUser = Request & { user?: AuthenticatedUser; correlationId?: string };

/** Injects the authenticated principal: `@CurrentUser() user: AuthenticatedUser`. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
