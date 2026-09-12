import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';
import { sellableProduct } from '../../testing/factories.js';

/**
 * The catalogue admin, against a real database — PRD F-AD-10 to F-AD-13.
 *
 * The happy path here writes across five tables in one request, which is precisely
 * what a stubbed Prisma cannot tell you anything about: a product, its variants, their
 * inventory rows, the collection links and the denormalised price rollups either all
 * land or the request should not have returned 201.
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

function newProduct(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);

  return {
    name: { fr: `Casquette ${suffix}`, en: `Cap ${suffix}`, ar: `قبعة ${suffix}` },
    slug: `cap-${suffix}`,
    status: 'ACTIVE',
    variants: [
      { sku: `INT-${suffix}-M`.toUpperCase(), price: 350_000, costPrice: 150_000, weightGrams: 200 },
      { sku: `INT-${suffix}-L`.toUpperCase(), price: 380_000, costPrice: 160_000, weightGrams: 210 },
    ],
    ...overrides,
  };
}

describe('POST /admin/products', () => {
  it('creates a product with its variants and returns the whole thing', async () => {
    const response = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send(newProduct());

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.variants).toHaveLength(2);

    const stored = await test.prisma.product.findUniqueOrThrow({
      where: { id: response.body.data.id },
      include: { variants: true },
    });
    expect(stored.variants).toHaveLength(2);
  });

  it('rolls the price range up onto the product, so grids never touch variants', async () => {
    const response = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send(newProduct())
      .expect(201);

    const stored = await test.prisma.product.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(stored.minPrice).toBe(350_000n);
    expect(stored.maxPrice).toBe(380_000n);
  });

  it('refuses a product with no variants, naming the field', async () => {
    const response = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send(newProduct({ variants: [] }))
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body.error.details)).toContain('variants');
  });

  it('refuses a duplicate slug rather than writing a second one', async () => {
    const payload = newProduct();

    await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send(payload)
      .expect(201);

    const second = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send({ ...payload, variants: newProduct().variants });

    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(await test.prisma.product.count({ where: { slug: payload.slug } })).toBe(1);
  });

  it('refuses a role that may read the catalogue but not write it', async () => {
    // An order agent looks products up while on the phone. That is read, not write.
    await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', agent.bearer)
      .send(newProduct())
      .expect(403);
  });

  it('lets that same agent read the list', async () => {
    await test.http.get('/api/v1/admin/products').set('Authorization', agent.bearer).expect(200);
  });
});

describe('GET /admin/products', () => {
  it('paginates and reports the true total', async () => {
    await sellableProduct(test.prisma);
    await sellableProduct(test.prisma);
    await sellableProduct(test.prisma);

    const response = await test.http
      .get('/api/v1/admin/products?pageSize=2&page=1')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(3);
  });

  it('filters by status without counting the ones it filtered out', async () => {
    await sellableProduct(test.prisma);
    await test.prisma.product.create({
      data: { name: { fr: 'Brouillon' }, slug: `draft-${Date.now()}`, status: 'DRAFT' },
    });

    const response = await test.http
      .get('/api/v1/admin/products?filter[status]=DRAFT')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.meta.total).toBe(1);
  });

  it('exports the list as a file rather than a JSON envelope', async () => {
    await sellableProduct(test.prisma);

    const response = await test.http
      .get('/api/v1/admin/products?format=csv')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.headers['content-type']).toContain('csv');
    expect(response.headers['content-disposition']).toContain('attachment');
  });
});

describe('PATCH and archive', () => {
  it('updates a product and gives back the updated entity', async () => {
    const created = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send(newProduct())
      .expect(201);

    const response = await test.http
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set('Authorization', owner.bearer)
      .send({ styleLabel: 'Heritage' })
      .expect(200);

    expect(response.body.data.styleLabel).toBe('Heritage');
  });

  it('answers 404 for a product that does not exist', async () => {
    await test.http
      .patch('/api/v1/admin/products/00000000-0000-0000-0000-000000000000')
      .set('Authorization', owner.bearer)
      .send({ styleLabel: 'x' })
      .expect(404);
  });
});

describe('GET /admin/categories', () => {
  it('returns the tree', async () => {
    await test.http.get('/api/v1/admin/categories').set('Authorization', owner.bearer).expect(200);
  });

  it('refuses a category with no name', async () => {
    const response = await test.http
      .post('/api/v1/admin/categories')
      .set('Authorization', owner.bearer)
      .send({ slug: 'no-name' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('creates one and reads it back', async () => {
    const slug = `cat-${Date.now()}`;

    const created = await test.http
      .post('/api/v1/admin/categories')
      .set('Authorization', owner.bearer)
      .send({ name: { fr: 'Casquettes', en: 'Caps', ar: 'قبعات' }, slug })
      .expect(201);

    expect(created.body.data.slug).toBe(slug);
    expect(await test.prisma.category.count({ where: { slug } })).toBe(1);
  });
});
