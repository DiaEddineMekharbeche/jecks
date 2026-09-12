import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';
import { cartWithItem, sellableProduct, someCommune } from '../../testing/factories.js';

/**
 * The admin orders module, against a real database — PRD Section 5, integration layer.
 *
 * Three things per controller, as the testing contract asks: the happy path, a refusal
 * for somebody without the permission, and a refusal for a body that does not validate.
 * The middle one is the reason this file exists — a permission that was never wired
 * looks identical to a working one in every unit test, because the unit test calls the
 * service directly and never passes the guard.
 */

let test: TestApp;
let owner: { bearer: string };
let agent: { bearer: string };

beforeAll(async () => {
  test = await createTestApp();
  owner = await signInAs(test, RoleSlug.OWNER);
  agent = await signInAs(test, RoleSlug.ORDER_AGENT);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

/** One real order, placed through checkout so it is exactly what the shop would hold. */
async function placeOrder(): Promise<{ id: string; number: string }> {
  const product = await sellableProduct(test.prisma);
  const cart = await cartWithItem(test.prisma, product, 2);
  const commune = await someCommune(test.prisma);

  const response = await test.http
    .post('/api/v1/orders')
    .set('Idempotency-Key', `int-${Date.now()}-${Math.random()}`)
    .send({
      cartToken: cart.token,
      customer: { fullName: 'Yacine Haddad', phone: '+213661234567' },
      shipping: {
        wilayaCode: commune.wilayaCode,
        communeId: commune.id,
        deliveryType: 'HOME',
        address: 'Cité 200 logements',
      },
      payment: { method: 'COD' },
    });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const number = response.body.data.number as string;
  const row = await test.prisma.order.findFirstOrThrow({ where: { number } });
  return { id: row.id, number };
}

describe('GET /admin/orders', () => {
  beforeEach(async () => {
    await resetData(test.prisma);
  });

  it('lists the orders that exist, with the list envelope', async () => {
    await placeOrder();

    const response = await test.http
      .get('/api/v1/admin/orders?perPage=10')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });

  it('refuses a request with no token at all', async () => {
    await test.http.get('/api/v1/admin/orders').expect(401);
  });

  it('refuses a role that does not hold the permission', async () => {
    // An order agent may read orders but must never reach the finances. Asking the API
    // directly is what somebody curious would do.
    await test.http
      .get('/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31')
      .set('Authorization', agent.bearer)
      .expect(403);
  });

  it('lets the same agent do the job they are there for', async () => {
    // A guard that refuses everything passes the test above and fails the shop.
    await test.http.get('/api/v1/admin/orders').set('Authorization', agent.bearer).expect(200);
  });
});

describe('POST /admin/orders/:id/transition', () => {
  beforeEach(async () => {
    await resetData(test.prisma);
  });

  it('moves an order to the next legal status and records the event', async () => {
    const order = await placeOrder();

    await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', owner.bearer)
      .send({ to: 'CONFIRMED' })
      .expect(201);

    const after = await test.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');

    const events = await test.prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events.some((event) => event.toStatus === 'CONFIRMED')).toBe(true);
  });

  it('refuses an illegal jump, and leaves the order where it was', async () => {
    const order = await placeOrder();

    await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', owner.bearer)
      .send({ to: 'DELIVERED' })
      .expect(400);

    const after = await test.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
  });

  it('rejects a body that does not validate, naming the field', async () => {
    const order = await placeOrder();

    const response = await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', owner.bearer)
      .send({ to: 'NOT_A_STATUS' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body.error.details)).toContain('to');
  });

  it('lets a warehouse hand move an order along, because packing is their job', async () => {
    const order = await placeOrder();
    const warehouse = await signInAs(test, RoleSlug.WAREHOUSE);

    await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', warehouse.bearer)
      .send({ to: 'CONFIRMED' })
      .expect(201);
  });

  it('refuses to let them cancel it, which is a different decision', async () => {
    const order = await placeOrder();
    const warehouse = await signInAs(test, RoleSlug.WAREHOUSE);

    // `orders.cancel` is its own permission and the warehouse role does not hold it.
    // Before this check existed, `orders.transition` was enough to end an order.
    await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', warehouse.bearer)
      .send({ to: 'CANCELLED', reason: 'changed my mind' })
      .expect(403);

    const after = await test.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
  });

  it('lets an order agent cancel, because that is exactly their job', async () => {
    const order = await placeOrder();
    const agentSession = await signInAs(test, RoleSlug.ORDER_AGENT);

    await test.http
      .post(`/api/v1/admin/orders/${order.id}/transition`)
      .set('Authorization', agentSession.bearer)
      .send({ to: 'CANCELLED', reason: 'client injoignable' })
      .expect(201);
  });

  it('answers 404 for an order that does not exist rather than 500', async () => {
    await test.http
      .post('/api/v1/admin/orders/00000000-0000-0000-0000-000000000000/transition')
      .set('Authorization', owner.bearer)
      .send({ to: 'CONFIRMED' })
      .expect(404);
  });
});

describe('order documents', () => {
  beforeEach(async () => {
    await resetData(test.prisma);
  });

  it('renders an invoice a reader will open', async () => {
    const order = await placeOrder();

    const response = await test.http
      .get(`/api/v1/admin/orders/${order.id}/documents/invoice.pdf`)
      .set('Authorization', owner.bearer)
      .expect(200)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.headers['content-type']).toContain('application/pdf');
    expect((response.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('refuses a batch of more than the printer cap', async () => {
    const ids = Array.from({ length: 201 }, () => '00000000-0000-0000-0000-000000000000');

    await test.http
      .post('/api/v1/admin/orders/documents/batch')
      .set('Authorization', owner.bearer)
      .send({ kind: 'invoice', orderIds: ids })
      .expect(422);
  });
});
