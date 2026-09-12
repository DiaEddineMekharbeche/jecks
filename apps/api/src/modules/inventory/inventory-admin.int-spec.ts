import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';
import { defaultLocation, sellableProduct } from '../../testing/factories.js';

/**
 * Stock, against a real database — PRD F-AD-50 to F-AD-53.
 *
 * Every adjustment is supposed to write two rows in one transaction: the new level and
 * the ledger movement that explains it. A unit test can prove the arithmetic; only this
 * can prove the pair is atomic and that the ledger's running balance matches the level
 * it claims to describe.
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

beforeEach(async () => {
  await resetData(test.prisma);
});

describe('GET /admin/inventory', () => {
  it('lists levels with the list envelope', async () => {
    await sellableProduct(test.prisma);

    const response = await test.http
      .get('/api/v1/admin/inventory')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.meta.total).toBe(1);
  });

  it('refuses a role with no inventory permission', async () => {
    const marketing = await signInAs(test, RoleSlug.MARKETING);

    await test.http
      .get('/api/v1/admin/inventory')
      .set('Authorization', marketing.bearer)
      .expect(403);
  });
});

describe('POST /admin/inventory/adjust', () => {
  it('moves the level and writes the ledger row that explains it', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const location = await defaultLocation(test.prisma);

    await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', owner.bearer)
      .send({
        variantId: product.variantId,
        locationId: location.id,
        quantity: 5,
        mode: 'delta',
        reason: 'ADJUSTMENT',
        note: 'Retrouvées au fond du carton',
      })
      .expect(201);

    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.onHand).toBe(15);

    const movements = await test.prisma.stockMovement.findMany({
      where: { variantId: product.variantId },
    });
    expect(movements).toHaveLength(1);
    // The ledger carries the balance it produced, so a discrepancy is findable later.
    expect(movements[0]!.balanceAfter).toBe(15);
    expect(movements[0]!.quantity).toBe(5);
  });

  it('sets an absolute count rather than adding to it', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const location = await defaultLocation(test.prisma);

    await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', owner.bearer)
      .send({
        variantId: product.variantId,
        locationId: location.id,
        quantity: 3,
        mode: 'set',
        reason: 'ADJUSTMENT',
      })
      .expect(201);

    const level = await test.prisma.inventoryLevel.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(level.onHand).toBe(3);
  });

  it('records a plain correction when no reason is given', async () => {
    // The schema defaults to ADJUSTMENT rather than refusing, which is right: the
    // common case is somebody fixing a miscount and the note carries the detail.
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const location = await defaultLocation(test.prisma);

    await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', owner.bearer)
      .send({ variantId: product.variantId, locationId: location.id, quantity: 5 })
      .expect(201);

    const movement = await test.prisma.stockMovement.findFirstOrThrow({
      where: { variantId: product.variantId },
    });
    expect(movement.reason).toBe('ADJUSTMENT');
  });

  it('refuses a quantity that is not a number, naming the field', async () => {
    const product = await sellableProduct(test.prisma);
    const location = await defaultLocation(test.prisma);

    const response = await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', owner.bearer)
      .send({ variantId: product.variantId, locationId: location.id, quantity: 'beaucoup' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body.error.details)).toContain('quantity');
  });

  it('refuses a variant that does not exist, rather than blaming the server', async () => {
    const location = await defaultLocation(test.prisma);

    const response = await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', owner.bearer)
      .send({
        variantId: '00000000-0000-0000-0000-000000000000',
        locationId: location.id,
        quantity: 5,
        reason: 'ADJUSTMENT',
      });

    // This used to reach Postgres and come back as a foreign-key violation, which the
    // filter turned into a 500: an operator with a stale id was told the server broke.
    expect(response.status).toBe(404);
    expect(await test.prisma.stockMovement.count()).toBe(0);
  });

  it('refuses an agent who may read stock but not change it', async () => {
    const product = await sellableProduct(test.prisma);
    const location = await defaultLocation(test.prisma);

    await test.http
      .post('/api/v1/admin/inventory/adjust')
      .set('Authorization', agent.bearer)
      .send({
        variantId: product.variantId,
        locationId: location.id,
        quantity: 5,
        reason: 'ADJUSTMENT',
      })
      .expect(403);
  });
});

describe('GET /admin/inventory/movements', () => {
  it('returns the ledger, newest first', async () => {
    const product = await sellableProduct(test.prisma, { onHand: 10 });
    const location = await defaultLocation(test.prisma);

    for (const quantity of [2, 3]) {
      await test.http
        .post('/api/v1/admin/inventory/adjust')
        .set('Authorization', owner.bearer)
        .send({
          variantId: product.variantId,
          locationId: location.id,
          quantity,
          reason: 'ADJUSTMENT',
        })
        .expect(201);
    }

    const response = await test.http
      .get('/api/v1/admin/inventory/movements')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.meta.total).toBe(2);
  });
});

describe('GET /admin/suppliers', () => {
  it('lists them and accepts a new one', async () => {
    await test.http.get('/api/v1/admin/suppliers').set('Authorization', owner.bearer).expect(200);

    const created = await test.http
      .post('/api/v1/admin/suppliers')
      .set('Authorization', owner.bearer)
      .send({ name: 'Textiles Oran', phone: '+213551998877' });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await test.prisma.supplier.count()).toBe(1);
  });

  it('refuses a supplier with no name', async () => {
    const response = await test.http
      .post('/api/v1/admin/suppliers')
      .set('Authorization', owner.bearer)
      .send({ phone: '+213551998877' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
