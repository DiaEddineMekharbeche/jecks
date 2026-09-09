import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Permission } from '@jecks/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../decorators/auth.decorators.js';
import { PermissionsGuard } from './permissions.guard.js';

function makeContext(user?: Partial<AuthenticatedUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(required: Permission[] | undefined): PermissionsGuard {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows a route that declares no permissions', () => {
    expect(makeGuard(undefined).canActivate(makeContext())).toBe(true);
    expect(makeGuard([]).canActivate(makeContext())).toBe(true);
  });

  it('allows a user holding the required permission', () => {
    const guard = makeGuard(['orders.read']);
    expect(guard.canActivate(makeContext({ permissions: ['orders.read', 'catalog.read'] }))).toBe(
      true,
    );
  });

  it('requires every listed permission, not just one', () => {
    const guard = makeGuard(['orders.read', 'finance.read']);
    expect(() => guard.canActivate(makeContext({ permissions: ['orders.read'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('names the missing permissions in the error, for the admin to act on', () => {
    const guard = makeGuard(['finance.read', 'reports.export']);
    try {
      guard.canActivate(makeContext({ permissions: ['reports.export'] }));
      expect.unreachable('the guard should have thrown');
    } catch (error) {
      const body = (error as ForbiddenException).getResponse() as {
        code: string;
        details: { missing: string[] };
      };
      expect(body.code).toBe('FORBIDDEN');
      expect(body.details.missing).toEqual(['finance.read']);
    }
  });

  it('denies an order agent reaching finance — PRD acceptance criterion 6', () => {
    const agent = { permissions: ['orders.read', 'orders.write', 'customers.read'] };
    expect(() => makeGuard(['finance.read']).canActivate(makeContext(agent))).toThrow(
      ForbiddenException,
    );
  });

  it('denies a driver anything beyond their own run', () => {
    const driver = { permissions: ['delivery.own_runs', 'orders.read'] };
    expect(makeGuard(['delivery.own_runs']).canActivate(makeContext(driver))).toBe(true);
    expect(() => makeGuard(['delivery.dispatch']).canActivate(makeContext(driver))).toThrow(
      ForbiddenException,
    );
  });

  it('denies an unauthenticated request on a permissioned route', () => {
    expect(() => makeGuard(['orders.read']).canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
