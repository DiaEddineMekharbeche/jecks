import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { sellableProduct, someCommune } from '../../testing/factories.js';

/**
 * A promotion code on the one-page order, against a real database.
 *
 * Two promises: the figure the shopper sees before ordering is the figure the order carries,
 * and a code the shop refuses is refused with a sentence — before anything is written. The
 * file is its own because the order route allows ten calls a minute and the other quick-order
 * tests already use most of them.
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

async function tenPercentCode(code = 'BIENVENUE10') {
  return test.prisma.promotion.create({
    data: { name: 'Bienvenue', type: 'PERCENTAGE', scope: 'ORDER', code, percentOff: 10 },
  });
}

function preview(variantId: string, code: string, extra: Record<string, unknown> = {}) {
  return test.http
    .post('/api/v1/orders/quick/promo')
    .send({ variantId, quantity: 2, code, ...extra });
}

function order(variantId: string, communeId: string, promoCode?: string) {
  return test.http
    .post('/api/v1/orders/quick')
    .set('Idempotency-Key', `promo-${Date.now()}-${Math.random()}`)
    .send({
      variantId,
      quantity: 2,
      customer: { fullName: 'Amel Zidane', phone: `+2136${String(Date.now()).slice(-8)}` },
      shipping: {
        wilayaCode: 16,
        communeId,
        deliveryType: 'HOME',
        address: 'Cité 1000 logements, bâtiment B',
      },
      payment: { method: 'COD' },
      ...(promoCode ? { promoCode } : {}),
    });
}

describe('POST /orders/quick/promo', () => {
  it('says what the code takes off, before anything is ordered', async () => {
    const product = await sellableProduct(test.prisma, { price: 400_000n });
    await tenPercentCode();

    const response = await preview(product.variantId, 'bienvenue10').expect(201);

    expect(response.body.data).toMatchObject({
      code: 'BIENVENUE10',
      subtotalMinor: '800000',
      discountMinor: '80000',
    });
    expect(BigInt(response.body.data.totalMinor)).toBe(
      800_000n - 80_000n + BigInt(response.body.data.shippingMinor),
    );
  });

  it('refuses a code the shop does not know, in words the shopper can read', async () => {
    const product = await sellableProduct(test.prisma);

    const response = await preview(product.variantId, 'NOPE2026').expect(400);

    expect(response.body.error.code).toBe('PROMO_REJECTED');
    expect(response.body.error.message).toBe('This code does not exist');
  });

  it('leaves no cart behind, whether the code works or not', async () => {
    const product = await sellableProduct(test.prisma);
    await tenPercentCode();

    await preview(product.variantId, 'BIENVENUE10').expect(201);
    await preview(product.variantId, 'NOPE2026').expect(400);

    expect(await test.prisma.cart.count()).toBe(0);
  });

  it('includes delivery once a destination is given', async () => {
    const product = await sellableProduct(test.prisma);
    await tenPercentCode();

    const response = await preview(product.variantId, 'BIENVENUE10', {
      wilayaCode: 16,
      deliveryType: 'HOME',
    }).expect(201);

    expect(response.body.data.shippingQuoted).toBe(true);
  });
});

describe('POST /orders/quick with a promotion code', () => {
  it('puts the discount on the order and records the use of the code', async () => {
    const product = await sellableProduct(test.prisma, { price: 400_000n });
    const promotion = await tenPercentCode();
    const commune = await someCommune(test.prisma);

    const response = await order(product.variantId, commune.id, 'bienvenue10');
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const placed = await test.prisma.order.findFirstOrThrow();
    expect(placed.discountTotal).toBe(80_000n);
    expect(placed.itemsSubtotal).toBe(800_000n);
    expect(await test.prisma.promoUsage.count({ where: { promotionId: promotion.id } })).toBe(1);
  });

  it('shows the same discount the preview promised', async () => {
    const product = await sellableProduct(test.prisma, { price: 400_000n });
    await tenPercentCode();
    const commune = await someCommune(test.prisma);

    const promised = (await preview(product.variantId, 'BIENVENUE10')).body.data.discountMinor;
    await order(product.variantId, commune.id, 'BIENVENUE10').expect(201);

    expect((await test.prisma.order.findFirstOrThrow()).discountTotal.toString()).toBe(promised);
  });

  it('refuses an unknown code and places nothing, so the shopper can fix it and go on', async () => {
    const product = await sellableProduct(test.prisma);
    const commune = await someCommune(test.prisma);

    const response = await order(product.variantId, commune.id, 'NOPE2026');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROMO_REJECTED');
    expect(await test.prisma.order.count()).toBe(0);
    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.reserved).toBe(0);
  });

  it('still takes an order with no code, as before', async () => {
    const product = await sellableProduct(test.prisma);
    const commune = await someCommune(test.prisma);

    await order(product.variantId, commune.id).expect(201);

    expect((await test.prisma.order.findFirstOrThrow()).discountTotal).toBe(0n);
  });
});
