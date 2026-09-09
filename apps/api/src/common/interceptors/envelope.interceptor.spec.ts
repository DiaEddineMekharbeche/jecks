import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

const context = {} as ExecutionContext;
const handlerFor = (value: unknown): CallHandler => ({ handle: () => of(value) });

async function run(value: unknown): Promise<unknown> {
  const interceptor = new EnvelopeInterceptor();
  return firstValueFrom(interceptor.intercept(context, handlerFor(value)));
}

describe('EnvelopeInterceptor', () => {
  it('wraps a bare payload in { data }', async () => {
    expect(await run({ id: 'abc' })).toEqual({ data: { id: 'abc' } });
  });

  it('wraps an array', async () => {
    expect(await run([1, 2])).toEqual({ data: [1, 2] });
  });

  it('passes through a handler that already supplies data and meta', async () => {
    const payload = { data: [{ id: 'a' }], meta: { total: 1, page: 1 } };
    expect(await run(payload)).toEqual(payload);
  });

  it('treats an object with a `data` key plus others as a plain payload', async () => {
    // A product that happens to have a `data` field must not be mistaken for an envelope.
    const payload = { data: 'x', name: 'cap' };
    expect(await run(payload)).toEqual({ data: { data: 'x', name: 'cap' } });
  });

  it('renders BigInt money as a decimal string', async () => {
    const result = (await run({ price: 350000n, cost: 129000n })) as {
      data: { price: string; cost: string };
    };
    expect(result.data.price).toBe('350000');
    expect(result.data.cost).toBe('129000');
  });

  it('renders BigInt nested in arrays and objects', async () => {
    const result = (await run({ items: [{ total: 1n }, { total: 2n }] })) as {
      data: { items: Array<{ total: string }> };
    };
    expect(result.data.items.map((item) => item.total)).toEqual(['1', '2']);
  });

  it('returns { data: null } for an empty response', async () => {
    expect(await run(undefined)).toEqual({ data: null });
    expect(await run(null)).toEqual({ data: null });
  });

  it('keeps a zero and a false value rather than nulling them', async () => {
    expect(await run(0)).toEqual({ data: 0 });
    expect(await run(false)).toEqual({ data: false });
  });
});
