import { describe, expect, it } from 'vitest';
import { applyQuery } from './api';

/**
 * How a filtered list becomes a URL.
 *
 * Every admin list keeps its state in the address bar so a filtered view is a link
 * somebody can send. The encoding has to survive that round trip, and the repeated-key
 * form is what the API's filter parser expects.
 */

function query(params: Parameters<typeof applyQuery>[1]): string {
  const url = new URL('https://admin.test/list');
  applyQuery(url, params);
  return decodeURIComponent(url.search);
}

describe('applyQuery', () => {
  it('writes a plain value', () => {
    expect(query({ page: 2, q: 'casquette' })).toBe('?page=2&q=casquette');
  });

  it('repeats the key for a list, which is how the API reads a multi-select filter', () => {
    // `filter[status]=A&filter[status]=B`, not `filter[status]=A,B`.
    expect(query({ 'filter[status]': ['PENDING', 'CONFIRMED'] })).toBe(
      '?filter[status]=PENDING&filter[status]=CONFIRMED',
    );
  });

  it('drops an empty value rather than sending an empty filter', () => {
    // A cleared search box must not narrow the list to rows whose name is "".
    expect(query({ q: '', page: 1 })).toBe('?page=1');
  });

  it('drops null and undefined', () => {
    expect(query({ a: null, b: undefined, c: 'kept' })).toBe('?c=kept');
  });

  it('drops the empty members of a list but keeps the rest', () => {
    expect(query({ 'filter[tag]': ['', 'ete'] })).toBe('?filter[tag]=ete');
  });

  it('sends nothing at all for an empty list, rather than a bare key', () => {
    expect(query({ 'filter[status]': [] })).toBe('');
  });

  it('keeps a zero, which is a real page size and a real minimum price', () => {
    expect(query({ minPrice: 0 })).toBe('?minPrice=0');
  });

  it('keeps false, which is a real filter value', () => {
    expect(query({ published: false })).toBe('?published=false');
  });

  it('does nothing when there is no query at all', () => {
    expect(query(undefined)).toBe('');
  });

  it('replaces rather than appends a repeated plain key', () => {
    const url = new URL('https://admin.test/list?page=1');
    applyQuery(url, { page: 3 });

    expect(url.searchParams.getAll('page')).toEqual(['3']);
  });
});
