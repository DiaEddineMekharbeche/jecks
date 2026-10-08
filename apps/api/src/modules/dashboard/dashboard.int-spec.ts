import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';
import { cartWithItem, sellableProduct, someCommune } from '../../testing/factories.js';

/**
 * The dashboard, against a real database.
 *
 * Its tiles read the `daily_stats` table, which the worker rebuilds at 00:20. Left at that,
 * an order placed this morning showed nowhere until tomorrow and a new shop opened its
 * dashboard to empty tiles. These tests start with that table empty — no worker has run —
 * and expect the figures to be there anyway.
 */

let test: TestApp;
let owner: { bearer: string };

beforeAll(async () => {
  test = await createTestApp();
  owner = await signInAs(test, RoleSlug.OWNER);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await resetData(test.prisma);
});

interface Tile {
  key: string;
  value: string | number;
}

async function summary(period = '30d') {
  const response = await test.http
    .get('/api/v1/admin/dashboard/summary')
    .query({ period })
    .set('Authorization', owner.bearer)
    .expect(200);
  const tiles = new Map<string, Tile>(
    (response.body.data.tiles as Tile[]).map((tile) => [tile.key, tile]),
  );
  return {
    tiles,
    series: response.body.data.series as Array<{ day: string; ordersCount: number }>,
  };
}

async function placeOrder(phone: string) {
  const product = await sellableProduct(test.prisma);
  const cart = await cartWithItem(test.prisma, product, 1);
  const commune = await someCommune(test.prisma);

  await test.http
    .post('/api/v1/orders')
    .set('Idempotency-Key', `dash-${phone}`)
    .send({
      cartToken: cart.token,
      customer: { fullName: 'Yacine Haddad', phone },
      shipping: {
        wilayaCode: commune.wilayaCode,
        communeId: commune.id,
        deliveryType: 'HOME',
        address: 'Cité 200 logements, Bt 4',
      },
      payment: { method: 'COD' },
    })
    .expect(201);
}

describe('GET /admin/dashboard/summary', () => {
  it('counts an order placed today without waiting for the nightly job', async () => {
    await placeOrder('+213661234567');
    expect(await test.prisma.dailyStat.count()).toBe(0);

    const { tiles, series } = await summary();

    expect(Number(tiles.get('orders')?.value)).toBe(1);
    expect(series.at(-1)?.ordersCount).toBe(1);
  });

  it('gives an empty shop a row for every day, so the chart shows zeros and not a gap', async () => {
    const { tiles, series } = await summary('7d');

    expect(Number(tiles.get('orders')?.value)).toBe(0);
    expect(series).toHaveLength(7);
  });

  it('refuses a role without report access', async () => {
    const agent = await signInAs(test, RoleSlug.ORDER_AGENT);

    await test.http
      .get('/api/v1/admin/dashboard/summary')
      .set('Authorization', agent.bearer)
      .expect(403);
  });
});
