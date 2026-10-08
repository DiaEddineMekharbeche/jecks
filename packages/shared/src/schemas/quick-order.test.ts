import { describe, expect, it } from 'vitest';
import { quickOrderSchema } from './checkout.js';

/**
 * The one-page order's field rules. These are the checks a customer meets on a phone
 * with an advert still open behind the page, so each one has to fail with a message the
 * form can show beside the right field.
 */

const VARIANT = '01a11b44-d872-7362-818f-bcd19dae1974';
const COMMUNE = '01a11b44-d855-73a0-b232-6f54fa8aeb17';

const valid = {
  variantId: VARIANT,
  quantity: 1,
  customer: { fullName: 'Amel Zidane', phone: '0661 22 33 44' },
  shipping: {
    wilayaCode: 16,
    communeId: COMMUNE,
    deliveryType: 'HOME',
    address: 'Cité 1000 logements, bâtiment B',
  },
  payment: { method: 'COD' },
};

function issues(input: unknown): Record<string, string> {
  const result = quickOrderSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
  );
}

describe('quickOrderSchema', () => {
  it('accepts the form as a customer fills it in', () => {
    const parsed = quickOrderSchema.parse(valid);
    // Stored in one canonical form, whatever was typed.
    expect(parsed.customer.phone).toBe('+213661223344');
    expect(parsed.quantity).toBe(1);
  });

  it('defaults to one piece', () => {
    const { quantity: _omitted, ...rest } = valid;
    expect(quickOrderSchema.parse(rest).quantity).toBe(1);
  });

  it('reads a quantity sent as text, as a form posts it', () => {
    expect(quickOrderSchema.parse({ ...valid, quantity: '3' }).quantity).toBe(3);
  });

  it.each([0, 11, -1, 1.5])('refuses a quantity of %s', (quantity) => {
    expect(issues({ ...valid, quantity })).toHaveProperty('quantity');
  });

  it('asks for a street address when delivering to the door', () => {
    const { address: _omitted, ...shipping } = valid.shipping;
    expect(issues({ ...valid, shipping })).toHaveProperty('shipping.address');
    expect(issues({ ...valid, shipping: { ...shipping, address: 'rue' } })).toHaveProperty(
      'shipping.address',
    );
  });

  it('asks for a pickup point instead when delivering to one', () => {
    const shipping = { wilayaCode: 16, communeId: COMMUNE, deliveryType: 'STOP_DESK' };
    expect(issues({ ...valid, shipping })).toHaveProperty('shipping.pickupPointId');
    expect(
      issues({
        ...valid,
        shipping: { ...shipping, pickupPointId: '01a11b44-d872-7362-818f-bcd19dae1975' },
      }),
    ).toEqual({});
  });

  it.each(['+33 6 12 34 56 78', '0450 11 22 33', '12345', ''])('refuses the phone %j', (phone) => {
    expect(issues({ ...valid, customer: { ...valid.customer, phone } })).toHaveProperty(
      'customer.phone',
    );
  });

  it('refuses a name that is too short to be one', () => {
    expect(issues({ ...valid, customer: { ...valid.customer, fullName: 'Al' } })).toHaveProperty(
      'customer.fullName',
    );
  });

  it('refuses a wilaya that does not exist', () => {
    expect(issues({ ...valid, shipping: { ...valid.shipping, wilayaCode: 59 } })).toHaveProperty(
      'shipping.wilayaCode',
    );
  });

  it('lets the note stay empty and caps it', () => {
    expect(
      issues({ ...valid, shipping: { ...valid.shipping, note: 'x'.repeat(501) } }),
    ).toHaveProperty('shipping.note');
    expect(issues({ ...valid, shipping: { ...valid.shipping, note: undefined } })).toEqual({});
  });

  it('has no place for a price, a cart or loyalty points', () => {
    const parsed = quickOrderSchema.parse({
      ...valid,
      price: '1',
      unitPrice: '1',
      cartToken: 'someone-elses-cart-token',
      loyaltyPointsToRedeem: 9999,
    });
    // Unknown keys are dropped, so none of them can reach the order.
    expect(parsed).not.toHaveProperty('price');
    expect(parsed).not.toHaveProperty('unitPrice');
    expect(parsed).not.toHaveProperty('cartToken');
    expect(parsed).not.toHaveProperty('loyaltyPointsToRedeem');
  });

  it('carries the advert attribution through', () => {
    const parsed = quickOrderSchema.parse({
      ...valid,
      source: 'FACEBOOK',
      utm: { source: 'facebook', medium: 'paid', campaign: 'caps-octobre' },
    });
    expect(parsed.source).toBe('FACEBOOK');
    expect(parsed.utm?.campaign).toBe('caps-octobre');
  });
});
