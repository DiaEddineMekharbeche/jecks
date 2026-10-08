import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';

/**
 * The delivery fee grid, against a real database — PRD F-AD-60.
 *
 * The shop owner sets one fee per wilaya. Couriers carry their own rows, each with the cost
 * that courier charges, and the cheapest specific row is what a shopper is quoted. A fee
 * typed into the default grid used to land on a row that lost to a courier's, so the admin
 * said "saved" and checkout charged the old price. These tests ask the question the owner
 * asks: after I save 777, what does the shop charge?
 *
 * Rates and couriers survive the suite's usual reset (they are reference data), so these
 * tests work in a wilaya no other spec uses, set it up themselves and put back what the
 * seed had there.
 */

const WILAYA = 47;
const NEIGHBOUR = 46;

let test: TestApp;
let owner: { bearer: string };
let seeded: Awaited<ReturnType<TestApp['prisma']['shippingRate']['findMany']>>;

beforeAll(async () => {
  test = await createTestApp();
  owner = await signInAs(test, RoleSlug.OWNER);
  for (const code of [WILAYA, NEIGHBOUR]) {
    await test.prisma.wilaya.upsert({
      where: { code },
      update: {},
      create: { code, name: { fr: `Wilaya ${code}` }, nameAscii: `Wilaya ${code}` },
    });
  }
  seeded = await test.prisma.shippingRate.findMany({
    where: { wilayaCode: { in: [WILAYA, NEIGHBOUR] } },
  });
}, 180_000);

afterAll(async () => {
  await clear();
  await test.prisma.shippingRate.createMany({ data: seeded });
  await test?.close();
});

beforeEach(clear);

async function clear() {
  await test.prisma.shippingRate.deleteMany({ where: { wilayaCode: { in: [WILAYA, NEIGHBOUR] } } });
  await test.prisma.shippingZone.deleteMany({
    where: { name: { path: ['fr'], equals: 'Zone de test' } },
  });
  await test.prisma.courier.deleteMany({ where: { slug: { in: ['test-rapide', 'test-eco'] } } });
}

async function twoCouriers() {
  const fast = await test.prisma.courier.create({ data: { name: 'Rapide', slug: 'test-rapide' } });
  const cheap = await test.prisma.courier.create({ data: { name: 'Eco', slug: 'test-eco' } });
  await test.prisma.shippingRate.createMany({
    data: [
      { wilayaCode: WILAYA, courierId: fast.id, deliveryType: 'HOME', price: 40000n, cost: 28000n },
      {
        wilayaCode: WILAYA,
        courierId: cheap.id,
        deliveryType: 'HOME',
        price: 30000n,
        cost: 21000n,
      },
    ],
  });
  return { fast, cheap };
}

function quote(deliveryType = 'HOME') {
  return test.http
    .get('/api/v1/shipping/quote')
    .query({ wilayaCode: WILAYA, deliveryType, subtotal: 100000 });
}

function save(cell: Record<string, unknown>) {
  return test.http
    .post('/api/v1/admin/shipping/rates/bulk')
    .set('Authorization', owner.bearer)
    .send({ cells: [{ wilayaCode: WILAYA, deliveryType: 'HOME', ...cell }] });
}

describe('POST /admin/shipping/rates/bulk', () => {
  it('changes what the shop charges in a wilaya, whichever courier would have carried it', async () => {
    await twoCouriers();
    expect((await quote()).body.data.price).toBe('30000');

    await save({ price: '77700' }).expect(201);

    expect((await quote()).body.data.price).toBe('77700');
  });

  it('keeps what each courier charges us, so the margin moves and the cost does not', async () => {
    const { fast, cheap } = await twoCouriers();

    await save({ price: '50000' }).expect(201);

    const rows = await test.prisma.shippingRate.findMany({ where: { wilayaCode: WILAYA } });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.courierId === fast.id)).toMatchObject({
      price: 50000n,
      cost: 28000n,
    });
    expect(rows.find((row) => row.courierId === cheap.id)).toMatchObject({
      price: 50000n,
      cost: 21000n,
    });
  });

  it('prices a wilaya that has no courier rate yet, as it always did', async () => {
    await save({ price: '45000' }).expect(201);

    expect((await quote()).body.data.price).toBe('45000');
  });

  it('leaves the other delivery type alone', async () => {
    const { fast } = await twoCouriers();
    await test.prisma.shippingRate.create({
      data: {
        wilayaCode: WILAYA,
        courierId: fast.id,
        deliveryType: 'STOP_DESK',
        price: 20000n,
        cost: 14000n,
      },
    });

    await save({ price: '60000' }).expect(201);

    expect((await quote('STOP_DESK')).body.data.price).toBe('20000');
  });

  it('still writes one courier alone when the grid is set to that courier', async () => {
    const { fast, cheap } = await twoCouriers();

    await save({ courierId: fast.id, price: '35000' }).expect(201);

    const rows = await test.prisma.shippingRate.findMany({ where: { wilayaCode: WILAYA } });
    expect(rows.find((row) => row.courierId === fast.id)?.price).toBe(35000n);
    expect(rows.find((row) => row.courierId === cheap.id)?.price).toBe(30000n);
  });
});

describe('GET /shipping/quote', () => {
  it('is not lowered by the rates of the other wilayas in the same zone', async () => {
    // The seed gives each row a wilaya and the zone that wilaya sits in. A zone fallback
    // that matched on the zone alone pulled in every neighbour's rate, and the cheapest of
    // them won.
    const zone = await test.prisma.shippingZone.create({
      data: { name: { fr: 'Zone de test' }, wilayaCodes: [WILAYA, NEIGHBOUR] },
    });
    const courier = await test.prisma.courier.create({ data: { name: 'Eco', slug: 'test-eco' } });
    await test.prisma.shippingRate.createMany({
      data: [
        {
          wilayaCode: NEIGHBOUR,
          zoneId: zone.id,
          courierId: courier.id,
          deliveryType: 'HOME',
          price: 10000n,
        },
        {
          wilayaCode: WILAYA,
          zoneId: zone.id,
          courierId: courier.id,
          deliveryType: 'HOME',
          price: 90000n,
        },
      ],
    });

    expect((await quote()).body.data.price).toBe('90000');
  });
});
