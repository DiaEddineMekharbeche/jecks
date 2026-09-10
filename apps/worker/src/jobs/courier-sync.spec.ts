import { describe, expect, it, vi } from 'vitest';
import { pollCourierTracking } from './courier-sync.js';

/** A stubbed fetch, so the job can be exercised without an API or a courier. */
function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;

  return { calls, fetchStub };
}

const base = { apiUrl: 'http://api.test/api/v1', token: 'internal-secret' };

describe('pollCourierTracking', () => {
  it('skips quietly when no internal token is configured', async () => {
    const { calls, fetchStub } = stub(200, {});
    const result = await pollCourierTracking({ ...base, token: undefined, fetch: fetchStub });

    expect(result.skipped).toBeDefined();
    expect(result.polled).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('calls the internal sync endpoint with the token', async () => {
    const { calls, fetchStub } = stub(200, { data: { polled: 5, applied: 2, couriers: [{}] } });
    await pollCourierTracking({ ...base, fetch: fetchStub });

    expect(calls[0]!.url).toBe('http://api.test/api/v1/internal/couriers/sync');
    expect((calls[0]!.init.headers as Record<string, string>)['x-internal-token']).toBe(
      'internal-secret',
    );
  });

  it('does not double the slash when the base URL has a trailing one', async () => {
    const { calls, fetchStub } = stub(200, { data: {} });
    await pollCourierTracking({ ...base, apiUrl: 'http://api.test/api/v1/', fetch: fetchStub });

    expect(calls[0]!.url).toBe('http://api.test/api/v1/internal/couriers/sync');
  });

  it('reads a report inside the response envelope', async () => {
    const { fetchStub } = stub(200, { data: { polled: 12, applied: 3, couriers: [{}, {}] } });
    const result = await pollCourierTracking({ ...base, fetch: fetchStub });

    expect(result).toEqual({ polled: 12, applied: 3, couriers: 2 });
  });

  it('reads a bare report too', async () => {
    const { fetchStub } = stub(200, { polled: 4, applied: 1, couriers: [{}] });
    const result = await pollCourierTracking({ ...base, fetch: fetchStub });

    expect(result.polled).toBe(4);
  });

  it('sends the limit it was given', async () => {
    const { calls, fetchStub } = stub(200, { data: {} });
    await pollCourierTracking({ ...base, limit: 50, fetch: fetchStub });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ limit: 50 });
  });

  it('fails loudly on a rejected call, so the queue retries', async () => {
    const { fetchStub } = stub(401, 'Invalid internal token');
    await expect(pollCourierTracking({ ...base, fetch: fetchStub })).rejects.toThrow(/401/);
  });

  it('reports an unreadable answer rather than counting zero', async () => {
    const { fetchStub } = stub(200, '<html>gateway</html>');
    await expect(pollCourierTracking({ ...base, fetch: fetchStub })).rejects.toThrow(/not JSON/);
  });

  it('treats an empty body as nothing polled', async () => {
    const { fetchStub } = stub(200, { data: null });
    expect(await pollCourierTracking({ ...base, fetch: fetchStub })).toEqual({
      polled: 0,
      applied: 0,
      couriers: 0,
    });
  });
});
