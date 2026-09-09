import type { ApiResponse } from '@jecks/shared';

/**
 * Server-side API client for React Server Components.
 *
 * Catalog reads are cached with Next's fetch cache and tagged, so an admin write can
 * invalidate exactly the affected pages instead of the whole site (PRD Section 10.7).
 */

const BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000/api/v1';

export interface FetchOptions {
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  /** Seconds. 0 disables caching for personalised responses. */
  revalidate?: number;
  tags?: string[];
  init?: RequestInit;
}

export class StorefrontApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorefrontApiError';
  }
}

function buildUrl(path: string, query: FetchOptions['query']): string {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiGet<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { query, revalidate = 60, tags, init } = options;

  const response = await fetch(buildUrl(path, query), {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    next: revalidate === 0 ? { revalidate: 0 } : { revalidate, tags },
  });

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok) {
    const error = payload?.error;
    throw new StorefrontApiError(
      response.status,
      error?.code ?? 'NETWORK_ERROR',
      error?.message ?? 'The shop is temporarily unavailable',
    );
  }
  return payload?.data as T;
}

/** Same call, but returns `meta` too — pagination needs it. */
export async function apiGetWithMeta<T>(
  path: string,
  options: FetchOptions = {},
): Promise<{ data: T; meta: Record<string, number> }> {
  const { query, revalidate = 60, tags, init } = options;
  const response = await fetch(buildUrl(path, query), {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    next: revalidate === 0 ? { revalidate: 0 } : { revalidate, tags },
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok) {
    throw new StorefrontApiError(
      response.status,
      payload?.error?.code ?? 'NETWORK_ERROR',
      payload?.error?.message ?? 'The shop is temporarily unavailable',
    );
  }
  return {
    data: payload?.data as T,
    meta: (payload?.meta ?? {}) as Record<string, number>,
  };
}

/** Turns a storage key into a browser URL. */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  return `${base}/media/${key}`;
}
