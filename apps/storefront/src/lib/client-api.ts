'use client';

import type { ApiResponse } from '@jecks/shared';

/**
 * Browser-side API client.
 *
 * Distinct from `lib/api.ts`, which runs in Server Components and talks to the API over
 * the internal network. This one runs in the shopper's browser, so it must go through
 * the public URL and must send cookies: the cart token and the shopper's session both
 * live in httpOnly cookies the script cannot read, which is the point.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientRequest extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set on the refresh call itself, so a failing refresh cannot recurse. */
  skipRefresh?: boolean;
}

/**
 * One in-flight refresh at a time.
 *
 * A page that fires four requests as an expired token lapses would otherwise rotate
 * the refresh token four times, and rotation is exactly what the API treats as theft.
 */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // The CSRF cookie is script-readable on purpose; copying it into a header is what
  // proves the request came from a page that could read our cookies.
  const csrf = /(?:^|;\s*)jk_csrf=([^;]+)/.exec(document.cookie)?.[1];

  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
    },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function clientApi<T>(path: string, options: ClientRequest = {}): Promise<T> {
  const { body, query, headers, skipRefresh, ...rest } = options;

  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const send = () =>
    fetch(url.toString(), {
      ...rest,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let response = await send();

  // The access cookie lives fifteen minutes; a shopper filling in a checkout form for
  // longer than that should not be told to sign in again.
  if (response.status === 401 && !skipRefresh && (await refreshSession())) {
    response = await send();
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'NETWORK_ERROR',
      payload?.error?.message ?? 'Something went wrong. Please try again.',
      payload?.error?.details,
    );
  }

  return payload?.data as T;
}

/**
 * Fire-and-forget POST that survives the page being closed.
 *
 * `sendBeacon` is the only way to make an unload-time request reliable, and it is the
 * difference between an analytics funnel that has an exit step and one that does not.
 */
export function beacon(path: string, body: unknown): void {
  const url = `${BASE}${path}`;
  const payload = JSON.stringify(body);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon(url, blob)) return;
  }

  void fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

/** Turns any thrown value into a sentence a shopper can read. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}
