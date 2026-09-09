import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestWithUser } from '../decorators/auth.decorators.js';
import { JwtAuthGuard, type AccessTokenPayload } from './jwt-auth.guard.js';

const payload: AccessTokenPayload = {
  sub: 'user-1',
  typ: 'STAFF',
  name: 'Maher',
  email: 'owner@jecks.dz',
  phone: '+213551000001',
  roles: ['owner'],
  perms: ['orders.read'],
  sid: 'session-1',
};

interface Harness {
  guard: JwtAuthGuard;
  request: RequestWithUser;
  context: ExecutionContext;
  verify: ReturnType<typeof vi.fn>;
}

function harness(options: {
  isPublic?: boolean;
  authorization?: string;
  cookies?: Record<string, string>;
  verifyResult?: AccessTokenPayload | Error;
}): Harness {
  const request = {
    headers: options.authorization ? { authorization: options.authorization } : {},
    cookies: options.cookies,
  } as unknown as RequestWithUser;

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(options.isPublic ?? false),
  } as unknown as Reflector;

  const verify = vi.fn().mockImplementation(() => {
    const result = options.verifyResult ?? payload;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const jwt = { verifyAsync: verify } as unknown as JwtService;
  const config = { getOrThrow: () => 'a'.repeat(32) } as unknown as ConfigService;

  return { guard: new JwtAuthGuard(reflector, jwt, config), request, context, verify };
}

describe('JwtAuthGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a protected route with no token', async () => {
    const { guard, context } = harness({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('allows a public route with no token', async () => {
    const { guard, context } = harness({ isPublic: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('accepts a bearer token and attaches the principal', async () => {
    const { guard, context, request } = harness({ authorization: 'Bearer good-token' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      type: 'STAFF',
      name: 'Maher',
      email: 'owner@jecks.dz',
      phone: '+213551000001',
      roles: ['owner'],
      permissions: ['orders.read'],
      sessionId: 'session-1',
    });
  });

  it('falls back to the access cookie, which is how an RSC render authenticates', async () => {
    const { guard, context, request, verify } = harness({ cookies: { jk_access: 'cookie-token' } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('cookie-token', expect.anything());
    expect(request.user?.id).toBe('user-1');
  });

  it('ignores an empty bearer header rather than verifying an empty string', async () => {
    const { guard, context, verify } = harness({ authorization: 'Bearer ' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an expired or tampered token', async () => {
    const { guard, context } = harness({
      authorization: 'Bearer bad',
      verifyResult: new Error('jwt expired'),
    });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('lets a public route through even when its token is invalid', async () => {
    const { guard, context, request } = harness({
      isPublic: true,
      authorization: 'Bearer bad',
      verifyResult: new Error('jwt expired'),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('defaults roles and permissions to empty when the token omits them', async () => {
    const partial = { sub: 'u', typ: 'CUSTOMER', name: 'C', email: null, phone: null, sid: 's' };
    const { guard, context, request } = harness({
      authorization: 'Bearer good',
      verifyResult: partial as unknown as AccessTokenPayload,
    });
    await guard.canActivate(context);
    expect(request.user?.roles).toEqual([]);
    expect(request.user?.permissions).toEqual([]);
  });
});
