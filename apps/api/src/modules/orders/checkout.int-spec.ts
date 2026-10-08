import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { cartWithItem, sellableProduct, someCommune } from '../../testing/factories.js';

/**
 * Guest checkout, against a real database — PRD Section 7 and acceptance criterion 1.
 *
 * The one write that matters most, and the one with the most that a stub cannot see:
 * stock is reserved, a customer is upserted by phone, totals are computed from the
 * prices actually in the database, and the idempotency key has to survive a replay
 * through a unique column rather than through a Redis lock that may not be there.
 */

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
}, 180_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await resetData(test.prisma);
});

interface CheckoutOptions {
  cartToken: string;
  communeId: string;
  wilayaCode: number;
  phone?: string;
  key?: string;
}

function checkout(options: CheckoutOptions) {
  return test.http
    .post('/api/v1/orders')
    .set('Idempotency-Key', options.key ?? `int-${Date.now()}-${Math.random()}`)
    .send({
      cartToken: options.cartToken,
      customer: { fullName: 'Yacine Haddad', phone: options.phone ?? '+213661234567' },
      shipping: {
        wilayaCode: options.wilayaCode,
        communeId: options.communeId,
        deliveryType: 'HOME',
        address: 'Cité 200 logements, Bt 4',
      },
      payment: { method: 'COD' },
    });
}

describe('POST /orders', () => {
  it('takes a guest order and gives back a number to track it with', async () => {
    const product = await sellableProduct(test.prisma);
    const cart = await cartWithItem(test.prisma, product, 2);
    const commune = await someCommune(test.prisma);

    const response = await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.number).toMatch(/^JK-/);
  });

  it('writes the order with its line snapshotted, not referenced', async () => {
    const product = await sellableProduct(test.prisma, { price: 400_000n });
    const cart = await cartWithItem(test.prisma, product, 2);
    const commune = await someCommune(test.prisma);

    await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
    });

    const order = await test.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items).toHaveLength(1);
    // The price is copied onto the line, so raising it tomorrow does not rewrite
    // yesterday's invoice.
    expect(order.items[0]!.unitPrice).toBe(400_000n);
    expect(order.items[0]!.quantity).toBe(2);
    expect(order.itemsSubtotal).toBe(800_000n);
  });

  it('creates the customer from the phone number', async () => {
    const product = await sellableProduct(test.prisma);
    const cart = await cartWithItem(test.prisma, product);
    const commune = await someCommune(test.prisma);

    await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
      phone: '+213770112233',
    });

    const customer = await test.prisma.customer.findUnique({ where: { phone: '+213770112233' } });
    expect(customer).not.toBeNull();
  });

  it('reserves the stock it just sold', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const cart = await cartWithItem(test.prisma, product, 3);
    const commune = await someCommune(test.prisma);

    await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
    });

    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    // Still on the shelf, but spoken for: the next shopper cannot buy the same three.
    expect(level.onHand).toBe(10);
    expect(level.reserved).toBe(3);
  });

  it('returns the first order rather than making a second one on a replay', async () => {
    const product = await sellableProduct(test.prisma);
    const cart = await cartWithItem(test.prisma, product);
    const commune = await someCommune(test.prisma);
    const key = `replay-${Date.now()}`;

    const first = await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
      key,
    });
    const second = await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
      key,
    });

    expect(first.body.data.number).toBe(second.body.data.number);
    expect(await test.prisma.order.count()).toBe(1);
  });

  it('refuses a body that does not validate, naming the fields', async () => {
    const response = await test.http
      .post('/api/v1/orders')
      .set('Idempotency-Key', `bad-${Date.now()}`)
      .send({ customer: { fullName: 'x' } })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    const fields = JSON.stringify(response.body.error.details);
    expect(fields).toContain('cartToken');
    expect(fields).toContain('shipping');
  });

  it('refuses an empty cart rather than writing an order worth nothing', async () => {
    const commune = await someCommune(test.prisma);
    const cart = await test.prisma.cart.create({
      data: { token: `empty${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const response = await checkout({
      cartToken: cart.token,
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await test.prisma.order.count()).toBe(0);
  });

  it('refuses a cart token that does not exist', async () => {
    const commune = await someCommune(test.prisma);

    const response = await checkout({
      cartToken: 'thiscartneverexisted',
      communeId: commune.id,
      wilayaCode: commune.wilayaCode,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /webhooks/couriers/:provider', () => {
  it('refuses a payload it cannot verify, and changes nothing', async () => {
    // A forged "delivered" turns an unpaid cash order into a paid one, so an
    // unverifiable body must never be read, let alone applied.
    const response = await test.http
      .post('/api/v1/webhooks/couriers/yalidine')
      .set('content-type', 'application/json')
      .send({ status: 'delivered', tracking: 'made-up' });

    expect([400, 401, 403]).toContain(response.status);
    expect(await test.prisma.shipmentEvent.count()).toBe(0);
  });

  it('accepts an unknown provider without a 500, because couriers retry forever', async () => {
    const response = await test.http
      .post('/api/v1/webhooks/couriers/not-a-courier')
      .set('content-type', 'application/json')
      .send({ anything: true });

    expect(response.status).toBeLessThan(500);
  });
});

/**
 * The one-page order an advert's landing page posts — a variant and the delivery details,
 * with no cart to build first. It has to be the cart checkout's twin, not a second
 * implementation, so these tests lean on what that path already guarantees.
 */
describe('POST /orders/quick', () => {
  function quick(
    variantId: string,
    commune: { id: string; wilayaCode: number },
    overrides: Record<string, unknown> = {},
    key = `quick-${Date.now()}-${Math.random()}`,
  ) {
    return test.http
      .post('/api/v1/orders/quick')
      .set('Idempotency-Key', key)
      .send({
        variantId,
        quantity: 1,
        customer: { fullName: 'Amel Zidane', phone: '0661 22 33 44' },
        shipping: {
          wilayaCode: commune.wilayaCode,
          communeId: commune.id,
          deliveryType: 'HOME',
          address: 'Cité 1000 logements, bâtiment B',
          note: 'Appeler avant de passer',
        },
        payment: { method: 'COD' },
        ...overrides,
      });
  }

  it('places an order from nothing but a variant and the form', async () => {
    const product = await sellableProduct(test.prisma, { price: 420_000n });
    const commune = await someCommune(test.prisma);

    const response = await quick(product.variantId, commune, { quantity: 2 });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.number).toMatch(/^JK-/);

    const order = await test.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.quantity).toBe(2);
    expect(order.itemsSubtotal).toBe(840_000n);
    expect(order.customerPhone).toBe('+213661223344');
    expect(order.note).toBe('Appeler avant de passer');
  });

  it('reserves stock exactly as the cart checkout does', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const commune = await someCommune(test.prisma);

    await quick(product.variantId, commune, { quantity: 3 });

    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.reserved).toBe(3);
  });

  it('prices the line from the database, whatever the browser claims', async () => {
    const product = await sellableProduct(test.prisma, { price: 500_000n });
    const commune = await someCommune(test.prisma);

    // Extra keys are not part of the contract; a price in the body must change nothing.
    const response = await quick(product.variantId, commune, { price: '1', unitPrice: '1' });

    expect(response.status).toBe(201);
    const order = await test.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items[0]!.unitPrice).toBe(500_000n);
  });

  it('returns the same order when the request is repeated, and makes no second one', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const commune = await someCommune(test.prisma);

    const first = await quick(product.variantId, commune, {}, 'tap-twice');
    const second = await quick(product.variantId, commune, {}, 'tap-twice');

    expect(second.status).toBeLessThan(300);
    expect(second.body.data.number).toBe(first.body.data.number);
    expect(await test.prisma.order.count()).toBe(1);
    // One cart for one order: the replay must not have built another.
    expect(await test.prisma.cart.count()).toBe(1);
    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.reserved).toBe(1);
  });

  it('leaves the visitor’s own cart out of the order', async () => {
    const other = await sellableProduct(test.prisma);
    const wanted = await sellableProduct(test.prisma);
    const commune = await someCommune(test.prisma);
    const theirCart = await cartWithItem(test.prisma, other, 1);

    const response = await quick(wanted.variantId, commune).set(
      'Cookie',
      `jk_cart=${theirCart.token}`,
    );

    expect(response.status).toBe(201);
    const order = await test.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items.map((item) => item.variantId)).toEqual([wanted.variantId]);
  });

  it('refuses a variant that does not exist, without creating an order', async () => {
    const commune = await someCommune(test.prisma);

    const response = await quick('00000000-0000-4000-8000-000000000000', commune);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await test.prisma.order.count()).toBe(0);
  });

  it('refuses more than the stock on hand', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 2 });
    const commune = await someCommune(test.prisma);

    const response = await quick(product.variantId, commune, { quantity: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('NOT_ENOUGH_STOCK');
    expect(response.body.error.details.available).toBe(2);
    expect(await test.prisma.order.count()).toBe(0);
    // Nothing was reserved for an order that was not placed.
    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.reserved).toBe(0);
  });

  it('records where an advert sent the shopper from', async () => {
    const product = await sellableProduct(test.prisma);
    const commune = await someCommune(test.prisma);

    await quick(product.variantId, commune, {
      source: 'INSTAGRAM',
      utm: { source: 'instagram', medium: 'paid', campaign: 'caps-octobre' },
    });

    const order = await test.prisma.order.findFirstOrThrow();
    expect(order.source).toBe('INSTAGRAM');
  });
});
