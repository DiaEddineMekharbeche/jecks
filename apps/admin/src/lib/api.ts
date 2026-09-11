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

/** Repeated keys are how list filters travel: filter[status]=A&filter[status]=B. */
export type QueryParams = Record<
  string,
  string | number | boolean | string[] | undefined | null
>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: QueryParams;
  /** Set on the refresh call itself, so a failing refresh cannot recurse. */
  skipRefresh?: boolean;
}

/**
 * The CSRF token the API issued at sign-in.
 *
 * Read from the cookie rather than held in a variable, so a tab opened after sign-in
 * has it too. The cookie is deliberately script-readable: it proves the caller could
 * read our cookies, which is exactly what a cross-site page cannot do.
 */
function csrfToken(): string | null {
  const match = /(?:^|;\s*)jk_csrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, skipRefresh, headers, ...rest } = options;
  const csrf = csrfToken();

  const url = new URL(`${BASE}${path}`, window.location.origin);
  applyQuery(url, query);

  const response = await fetch(url.toString(), {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
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
  applyQuery(url, query);
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

/** Appends query values, repeating a key once per entry for array values. */
export function applyQuery(url: URL, query: QueryParams | undefined): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== '') url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

/**
 * Fetches a file and hands it to the browser as a download.
 *
 * A plain link cannot do this: the bearer token lives in memory rather than in a
 * cookie, so the request has to go through fetch and the result has to be turned back
 * into something the browser will save.
 *
 * The filename comes from the server's `Content-Disposition` when it sends one, because
 * the server is what knows the run code or the order number.
 */
export async function download(path: string, options: RequestOptions = {}): Promise<void> {
  const { body, query, headers, ...rest } = options;

  const url = new URL(`${BASE}${path}`, window.location.origin);
  applyQuery(url, query);

  const response = await fetch(url.toString(), {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: ApiError } | null;
    const error = payload?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'DOWNLOAD_FAILED',
      error?.message ?? 'Le téléchargement a échoué',
      error?.details,
    );
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filenameFrom(response.headers.get('content-disposition')) ?? 'document.pdf';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]!) : null;
}
