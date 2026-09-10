import { describe, expect, it, vi } from 'vitest';
import { runMaintenanceTask } from './maintenance-tasks.js';

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

describe('runMaintenanceTask', () => {
  it('skips quietly when no internal token is configured', async () => {
    const { calls, fetchStub } = stub(200, {});
    const result = await runMaintenanceTask('segments', {
      ...base,
      token: undefined,
      fetch: fetchStub,
    });

    expect(result.skipped).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('calls the endpoint named by the task', async () => {
    const { calls, fetchStub } = stub(200, { data: { created: 3 } });
    await runMaintenanceTask('recurring-expenses', { ...base, fetch: fetchStub });

    expect(calls[0]!.url).toBe('http://api.test/api/v1/internal/maintenance/recurring-expenses');
    expect((calls[0]!.init.headers as Record<string, string>)['x-internal-token']).toBe(
      'internal-secret',
    );
  });

  it('passes the report through, envelope or not', async () => {
    const wrapped = await runMaintenanceTask('segments', {
      ...base,
      fetch: stub(200, { data: { scanned: 100, changed: 4 } }).fetchStub,
    });
    expect(wrapped.report).toEqual({ scanned: 100, changed: 4 });

    const bare = await runMaintenanceTask('segments', {
      ...base,
      fetch: stub(200, { scanned: 7 }).fetchStub,
    });
    expect(bare.report).toEqual({ scanned: 7 });
  });

  it('fails loudly on a rejected call, so the queue retries', async () => {
    const { fetchStub } = stub(401, 'Invalid internal token');
    await expect(
      runMaintenanceTask('loyalty-expiry', { ...base, fetch: fetchStub }),
    ).rejects.toThrow(/401/);
  });

  it('reports an unreadable answer rather than a silent success', async () => {
    const { fetchStub } = stub(200, '<html>gateway</html>');
    await expect(runMaintenanceTask('segments', { ...base, fetch: fetchStub })).rejects.toThrow(
      /not JSON/,
    );
  });

  it('treats an empty body as an empty report', async () => {
    const { fetchStub } = stub(200, { data: null });
    expect((await runMaintenanceTask('segments', { ...base, fetch: fetchStub })).report).toEqual({});
  });
});
