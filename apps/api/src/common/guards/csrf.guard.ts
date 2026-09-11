import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Cross-site request forgery, for the routes a cookie alone can authenticate.
 *
 * The API is normally driven by a bearer token held in memory, which a forged
 * cross-site request cannot read or attach. The refresh cookie is the exception: it is
 * sent by the browser automatically, so a page on another origin could trigger a
 * refresh, or a logout, simply by making the request.
 *
 * The defence is a double-submit token. A cookie the browser sends automatically, and a
 * header only our own JavaScript can set, must agree. Another origin can cause the
 * cookie to be sent but cannot read it to produce the header.
 *
 * CORS already restricts which origins may make credentialed requests; this is the
 * second lock, for the day a CORS entry is added carelessly.
 */

export const CSRF_COOKIE = 'jk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Reads are safe by definition and never carry one. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Routes where the cookie alone is the credential.
 *
 * Everything else either needs a bearer token, or is a webhook verified by signature,
 * where a CSRF token would be meaningless — the sender is not a browser.
 */
const COOKIE_ROUTES = [/^\/api\/v1\/auth\/refresh$/, /^\/api\/v1\/auth\/logout$/];

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) return true;
    if (!COOKIE_ROUTES.some((pattern) => pattern.test(request.path))) return true;

    // A request that carries a bearer token proves it came from our own script; the
    // cookie is not what is authenticating it.
    if (request.headers.authorization?.startsWith('Bearer ')) return true;

    const cookie = (request.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!cookie || !provided || !constantTimeEquals(cookie, provided)) {
      throw new ForbiddenException({
        code: 'CSRF_FAILED',
        message: 'This request could not be verified. Reload the page and try again.',
      });
    }

    return true;
  }
}

/** Issues a token and sets the cookie the header has to match. */
export function issueCsrfToken(response: Response, secure: boolean, domain: string): string {
  const token = randomBytes(24).toString('base64url');

  response.cookie(CSRF_COOKIE, token, {
    // Deliberately readable by script: our own code has to copy it into the header.
    // It is not a credential on its own, only proof that the request came from a page
    // that could read our cookies.
    httpOnly: false,
    sameSite: 'lax',
    secure,
    domain,
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });

  return token;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
