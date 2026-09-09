import type { ApiError, ApiResponse } from '@jecks/shared';

/**
 * Thin fetch wrapper around the API envelope of PRD Section 10.3.
 *
 * The access token is held in memory only. The refresh token lives in an httpOnly
 * cookie the browser sends automatically, so a 401 triggers one silent refresh and a
 * single retry before the user is sent back to the sign-in screen.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onSessionLost(handler: () => void): void {
  onUnauthenticated = handler;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Field-level messages from a Zod failure, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const item of this.details as Array<{ path?: string; message?: string }>) {
      if (item.path && item.message) out[item.path] = item.message;
    }
    return out;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set on the refresh call itself, so a failing refresh cannot recurse. */
  skipRefresh?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, skipRefresh, headers, ...rest } = options;

  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && !skipRefresh) {
    const recovered = await refreshOnce();
    if (recovered) return api<T>(path, { ...options, skipRefresh: true });
    onUnauthenticated?.();
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok) {
    const error: ApiError = payload?.error ?? {
      code: 'NETWORK_ERROR',
      message: 'The server could not be reached',
    };
    throw new ApiRequestError(response.status, error.code, error.message, error.details);
  }

  return (payload?.data ?? null) as T;
}

/** Collapses concurrent 401s into a single refresh round-trip. */
async function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const result = await api<{ accessToken: string }>('/auth/refresh', {
        method: 'POST',
        skipRefresh: true,
      });
      setAccessToken(result.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Same call shape as `api`, but returns the envelope so `meta` survives. */
export async function apiWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const { body, query, headers, ...rest } = options;
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok) {
    const error = payload?.error ?? { code: 'NETWORK_ERROR', message: 'The server could not be reached' };
    throw new ApiRequestError(response.status, error.code, error.message, error.details);
  }
  return { data: payload?.data as T, meta: payload?.meta as Record<string, unknown> | undefined };
}
