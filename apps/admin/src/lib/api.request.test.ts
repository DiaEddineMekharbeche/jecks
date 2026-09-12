import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, getAccessToken, onSessionLost, setAccessToken } from './api';

/**
 * The request layer, and the refresh that keeps a session alive.
 *
 * The access token lives in memory for fifteen minutes, so a long afternoon on the
 * orders screen hits a 401 on some ordinary click. What happens next is invisible when
 * it works and looks like the application logging somebody out at random when it does
 * not, which is why it is worth pinning.
 */

const original = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }>;

/** Queues responses; each call takes the next one. */
function respondWith(...responses: Array<{ status: number; body?: unknown }>) {
  calls = [];
  let index = 0;

  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index++, responses.length - 1)]!;

    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? null,
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

describe('api', () => {
  it('unwraps the envelope, so a caller never sees `data`', () => {
    respondWith({ status: 200, body: { data: { id: 'order-1' } } });

    return expect(api('/admin/orders/order-1')).resolves.toEqual({ id: 'order-1' });
  });

  it('sends the bearer token when there is one', async () => {
    setAccessToken('tok_123');
    respondWith({ status: 200, body: { data: null } });

    await api('/admin/orders');

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_123');
  });

  it('sends no authorization header when signed out', async () => {
    respondWith({ status: 200, body: { data: null } });

    await api('/admin/orders');

    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends a JSON content type only when there is a body', async () => {
    respondWith({ status: 200, body: { data: null } });

    await api('/admin/orders');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();

    await api('/admin/orders', { method: 'POST', body: { a: 1 } });
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(calls[1]!.init.body).toBe('{"a":1}');
  });

  it('returns nothing for a 204 rather than trying to parse a body', async () => {
    // Every delete answers 204. Parsing it would throw on an empty response.
    respondWith({ status: 204 });

    await expect(api('/admin/orders/x')).resolves.toBeUndefined();
  });

  it('throws the API’s own code and message, which the screen shows verbatim', async () => {
    respondWith({
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Champs à corriger',
          details: [{ path: 'slug', message: 'Obligatoire' }],
        },
      },
    });

    await expect(api('/admin/products', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Champs à corriger',
    });
  });

  it('keeps the field detail reachable from the thrown error', async () => {
    respondWith({
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [{ path: 'name.fr', message: 'Obligatoire' }],
        },
      },
    });

    const error = await api('/admin/products', { method: 'POST', body: {} }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).fieldErrors).toEqual({ 'name.fr': 'Obligatoire' });
  });

  it('reports a failure with no readable body rather than throwing on the parse', async () => {
    // An Nginx 502 page is not JSON.
    respondWith({ status: 502, body: null });

    await expect(api('/admin/orders')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('api — the refresh', () => {
  it('refreshes once on a 401 and replays the original request', async () => {
    setAccessToken('expired');

    respondWith(
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      { status: 200, body: { data: { accessToken: 'tok_fresh' } } },
      { status: 200, body: { data: { id: 'order-1' } } },
    );

    await expect(api('/admin/orders/order-1')).resolves.toEqual({ id: 'order-1' });

    // Original, refresh, replay.
    expect(calls).toHaveLength(3);
    expect(calls[1]!.url).toContain('/auth/refresh');
    expect(getAccessToken()).toBe('tok_fresh');
  });

  it('replays with the new token, not the expired one', async () => {
    setAccessToken('expired');

    respondWith(
      { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      { status: 200, body: { data: { accessToken: 'tok_fresh' } } },
      { status: 200, body: { data: null } },
    );

    await api('/admin/orders');

    expect((calls[2]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok_fresh');
  });

  it('gives up rather than looping when the refresh itself is refused', async () => {
    const lost = vi.fn();
    onSessionLost(lost);
    setAccessToken('expired');

    // Everything answers 401, including the refresh.
    respondWith({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Expiré' } } });

    await expect(api('/admin/orders')).rejects.toMatchObject({ status: 401 });

    // Original, refresh, replay — and then it stops. A retry that refreshed again would
    // spin until the tab was closed.
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(getAccessToken()).toBeNull();
  });

  it('does not try to refresh when told not to', async () => {
    // Sign-in answers 401 for a wrong password; refreshing there would be nonsense.
    respondWith({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Non' } } });

    await expect(
      api('/auth/staff/login', { method: 'POST', body: {}, skipRefresh: true }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(calls).toHaveLength(1);
  });

  it('collapses two simultaneous 401s into one refresh', async () => {
    setAccessToken('expired');

    let refreshes = 0;
    calls = [];

    globalThis.fetch = vi.fn(async (url: string) => {
      const target = String(url);

      if (target.includes('/auth/refresh')) {
        refreshes += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { accessToken: 'tok_fresh' } }),
        } as Response;
      }

      // Unauthorised until the token has been replaced.
      const authorised = getAccessToken() === 'tok_fresh';
      return {
        ok: authorised,
        status: authorised ? 200 : 401,
        json: async () =>
          authorised ? { data: null } : { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      } as Response;
    }) as unknown as typeof fetch;

    await Promise.all([api('/admin/orders'), api('/admin/customers')]);

    // Two round-trips to the refresh endpoint would be two new sessions, and the second
    // would invalidate the first.
    expect(refreshes).toBe(1);
  });
});
