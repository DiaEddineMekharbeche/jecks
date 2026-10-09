import { PROMO_REJECTIONS } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import { promoRefusal } from './promo-messages';

describe('promoRefusal', () => {
  it('has a sentence in every language for every reason the shop can give', () => {
    // A reason added to the API without wording here would show the shopper an English line
    // on a French page. This fails the build instead.
    for (const reason of Object.keys(PROMO_REJECTIONS)) {
      for (const locale of ['fr', 'ar', 'en'] as const) {
        expect(promoRefusal({ reason }, locale), `${reason} / ${locale}`).toBeTruthy();
      }
    }
  });

  it('leaves an unknown reason, or no details at all, to the caller’s fallback', () => {
    expect(promoRefusal({ reason: 'SOMETHING_NEW' }, 'fr')).toBeUndefined();
    expect(promoRefusal(undefined, 'fr')).toBeUndefined();
    expect(promoRefusal(null, 'fr')).toBeUndefined();
    expect(promoRefusal('x', 'fr')).toBeUndefined();
  });
});
