import { describe, expect, it } from 'vitest';
import { readAttribution } from './offer';

describe('readAttribution', () => {
  it.each([
    ['?utm_source=instagram', 'INSTAGRAM'],
    ['?utm_source=IG', 'INSTAGRAM'],
    ['?utm_source=facebook&utm_medium=paid', 'FACEBOOK'],
    ['?utm_source=fb', 'FACEBOOK'],
    ['?utm_source=tiktok', 'TIKTOK'],
    ['?utm_source=newsletter', 'WEB'],
    ['', 'WEB'],
  ])('reads %j as %s', (search, source) => {
    expect(readAttribution(search).source).toBe(source);
  });

  it('keeps the campaign details and trims them', () => {
    const result = readAttribution(
      '?utm_source=facebook&utm_campaign=caps-octobre&utm_content=' + 'x'.repeat(200),
    );
    expect(result.utm?.campaign).toBe('caps-octobre');
    expect(result.utm?.content).toHaveLength(120);
  });

  it('sends no utm object when the address carried none', () => {
    expect(readAttribution('?ref=abc').utm).toBeUndefined();
  });
});
