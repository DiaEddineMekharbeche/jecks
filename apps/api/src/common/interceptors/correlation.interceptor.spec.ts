import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CorrelationInterceptor } from './correlation.interceptor.js';

function harness(headers: Record<string, string> = {}) {
  const request: {
    method: string;
    originalUrl: string;
    headers: Record<string, string>;
    user: undefined;
    correlationId?: string;
  } = {
    method: 'GET',
    originalUrl: '/api/v1/catalog/products',
    headers,
    user: undefined,
  };
  const setHeader = vi.fn();
  const response = { statusCode: 200, setHeader };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { request, response, setHeader, context };
}

describe('CorrelationInterceptor', () => {
  it('generates a correlation id and echoes it in the response header', async () => {
    const { context, request, setHeader } = harness();
    const interceptor = new CorrelationInterceptor();
    await firstValueFrom(interceptor.intercept(context, { handle: () => of('ok') } as CallHandler));

    expect(request.correlationId).toMatch(/^[\w-]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', request.correlationId);
  });

  it('reuses an incoming correlation id, so a trace survives across services', async () => {
    const { context, request } = harness({ 'x-correlation-id': 'from-nginx' });
    const interceptor = new CorrelationInterceptor();
    await firstValueFrom(interceptor.intercept(context, { handle: () => of('ok') } as CallHandler));
    expect(request.correlationId).toBe('from-nginx');
  });

  it('truncates an oversized incoming id rather than logging it whole', async () => {
    const { context, request } = harness({ 'x-correlation-id': 'x'.repeat(500) });
    const interceptor = new CorrelationInterceptor();
    await firstValueFrom(interceptor.intercept(context, { handle: () => of('ok') } as CallHandler));
    expect(request.correlationId).toHaveLength(64);
  });

  it('still logs when the handler throws, so failures appear in the access log', async () => {
    const { context } = harness();
    const interceptor = new CorrelationInterceptor();
    const spy = vi.spyOn(interceptor['logger'], 'log').mockImplementation(() => undefined);

    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler),
      ),
    ).rejects.toThrow('boom');

    expect(spy).toHaveBeenCalledOnce();
  });

  it('labels the actor as guest when there is no principal', async () => {
    const { context } = harness();
    const interceptor = new CorrelationInterceptor();
    const spy = vi.spyOn(interceptor['logger'], 'log').mockImplementation(() => undefined);

    await firstValueFrom(interceptor.intercept(context, { handle: () => of('ok') } as CallHandler));
    expect(spy.mock.calls[0]?.[0]).toContain('guest');
  });
});
