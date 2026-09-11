import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER, CsrfGuard, constantTimeEquals } from './csrf.guard.js';

/**
 * The double-submit check.
 *
 * The property being defended is narrow and worth stating: a page on another origin can
 * cause the browser to send our cookies, but cannot read them. So it can reach the
 * refresh route, and cannot produce the header that route now demands.
 */

function context(options: {
  method?: string;
  path?: string;
  cookie?: string;
  header?: string;
  authorization?: string;
}): ExecutionContext {
  const request = {
    method: options.method ?? 'POST',
    path: options.path ?? '/api/v1/auth/refresh',
    cookies: options.cookie ? { [CSRF_COOKIE]: options.cookie } : {},
    headers: {
      ...(options.header ? { [CSRF_HEADER]: options.header } : {}),
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
  };

  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('accepts a matching cookie and header', () => {
    expect(guard.canActivate(context({ cookie: 'tok', header: 'tok' }))).toBe(true);
  });

  it('refuses when the header is missing, which is the forged case', () => {
    expect(() => guard.canActivate(context({ cookie: 'tok' }))).toThrow(/could not be verified/);
  });

  it('refuses when they disagree', () => {
    expect(() => guard.canActivate(context({ cookie: 'tok', header: 'other' }))).toThrow();
  });

  it('refuses when there is no cookie at all', () => {
    expect(() => guard.canActivate(context({ header: 'tok' }))).toThrow();
  });

  it('lets reads through untouched', () => {
    expect(guard.canActivate(context({ method: 'GET' }))).toBe(true);
  });

  it('ignores routes a cookie cannot authenticate on its own', () => {
    // A bearer token is required there, and a cross-site page cannot read one.
    expect(guard.canActivate(context({ path: '/api/v1/admin/orders' }))).toBe(true);
  });

  it('ignores webhooks, where the sender is not a browser', () => {
    expect(guard.canActivate(context({ path: '/api/v1/webhooks/couriers/maystro' }))).toBe(true);
  });

  it('accepts a request that already proves itself with a bearer token', () => {
    expect(guard.canActivate(context({ authorization: 'Bearer abc' }))).toBe(true);
  });

  it('guards logout too, so nobody can be signed out from another origin', () => {
    expect(() => guard.canActivate(context({ path: '/api/v1/auth/logout', cookie: 'a' }))).toThrow();
  });
});

describe('constantTimeEquals', () => {
  it('matches identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  it('rejects different lengths without throwing', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('rejects same-length differences', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });
});
