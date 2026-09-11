import { describe, expect, it, vi } from 'vitest';
import { runReportExport } from './report-export.js';

/**
 * The worker half of a queued export.
 *
 * All it does is call one route, so what is worth testing is the handling around that
 * call: the cases where it must not pretend to have succeeded.
 */

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response);
}

const CONFIG = { apiUrl: 'http://api.test/api/v1', token: 'secret' };

describe('runReportExport', () => {
  it('reports what the export produced', async () => {
    const call = respond(200, { data: { rows: 4213, key: 'exports/sales-by-product.xlsx' } });

    const result = await runReportExport('job-1', { ...CONFIG, fetch: call });

    expect(result).toEqual({
      jobId: 'job-1',
      rows: 4213,
      key: 'exports/sales-by-product.xlsx',
    });
  });

  it('sends the token and the job id, and nothing else', async () => {
    const call = respond(200, { data: { rows: 0 } });

    await runReportExport('job-2', { ...CONFIG, fetch: call });

    const [url, init] = call.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/internal/reports/export');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('secret');
    expect(JSON.parse(String(init.body))).toEqual({ jobId: 'job-2' });
  });

  it('does not double the slash when the API url has a trailing one', async () => {
    const call = respond(200, { data: {} });

    await runReportExport('job-3', { apiUrl: 'http://api.test/api/v1/', token: 't', fetch: call });

    expect(call.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/internal/reports/export');
  });

  it('reads a body that arrived without the envelope', async () => {
    const call = respond(200, { rows: 12, key: 'exports/x.csv' });

    const result = await runReportExport('job-4', { ...CONFIG, fetch: call });

    expect(result.rows).toBe(12);
  });

  it('fails loudly when the token is missing, because somebody is waiting for a file', async () => {
    // Unlike the nightly tasks, which skip quietly: this job only exists because a
    // person pressed a button.
    await expect(runReportExport('job-5', { apiUrl: CONFIG.apiUrl, token: undefined })).rejects.toThrow(
      /INTERNAL_API_TOKEN/,
    );
  });

  it('refuses a job queued without an id rather than calling with an empty one', async () => {
    const call = respond(200, {});

    await expect(runReportExport('', { ...CONFIG, fetch: call })).rejects.toThrow(/jobId/);
    expect(call).not.toHaveBeenCalled();
  });

  it('surfaces the status when the route refuses', async () => {
    const call = respond(500, { error: { message: 'the report blew up' } });

    await expect(runReportExport('job-6', { ...CONFIG, fetch: call })).rejects.toThrow(/500/);
  });

  it('says so when the answer is not JSON, rather than returning nothing', async () => {
    // An Nginx error page is the realistic case here.
    const call = respond(200, '<html>502 Bad Gateway</html>');

    await expect(runReportExport('job-7', { ...CONFIG, fetch: call })).rejects.toThrow(/not JSON/);
  });

  it('leaves no timer behind when the call fails', async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue(new Error('socket hang up'));

    await expect(runReportExport('job-8', { ...CONFIG, fetch: call })).rejects.toThrow(
      /socket hang up/,
    );
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });
});
