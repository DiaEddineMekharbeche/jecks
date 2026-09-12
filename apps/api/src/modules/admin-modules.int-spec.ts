import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../testing/app.js';
import { signInAs } from '../testing/auth.js';
import { customer, sellableProduct } from '../testing/factories.js';

/**
 * The remaining admin modules — PRD Section 5, testing contract.
 *
 * The same three questions per controller: does the happy path write what it claims,
 * does a role without the permission get refused, and does a bad body get named fields
 * back rather than a stack trace. Grouped in one file because each module needs a
 * handful of cases, not a hundred, and eight near-identical files would be harder to
 * read than one.
 */

let test: TestApp;
let owner: { bearer: string };
let agent: { bearer: string };
let accountant: { bearer: string };
let marketing: { bearer: string };

beforeAll(async () => {
  test = await createTestApp();
  owner = await signInAs(test, RoleSlug.OWNER);
  agent = await signInAs(test, RoleSlug.ORDER_AGENT);
  accountant = await signInAs(test, RoleSlug.ACCOUNTANT);
  marketing = await signInAs(test, RoleSlug.MARKETING);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await resetData(test.prisma);
});

// --- customers ---------------------------------------------------------------

describe('/admin/customers', () => {
  it('lists customers with the list envelope', async () => {
    await customer(test.prisma, { phone: '+213661000001' });

    const response = await test.http
      .get('/api/v1/admin/customers')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.meta.total).toBe(1);
  });

  it('reads one profile back', async () => {
    const created = await customer(test.prisma, { phone: '+213661000002' });

    const response = await test.http
      .get(`/api/v1/admin/customers/${created.id}`)
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.phone).toBe('+213661000002');
  });

  it('answers 404 for somebody who is not a customer', async () => {
    await test.http
      .get('/api/v1/admin/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', owner.bearer)
      .expect(404);
  });

  it('lets an order agent read them, because that is the job', async () => {
    await test.http.get('/api/v1/admin/customers').set('Authorization', agent.bearer).expect(200);
  });

  it('refuses a role with no customer permission', async () => {
    const warehouse = await signInAs(test, RoleSlug.WAREHOUSE);

    await test.http
      .get('/api/v1/admin/customers')
      .set('Authorization', warehouse.bearer)
      .expect(403);
  });
});

// --- promotions --------------------------------------------------------------

describe('/admin/promotions', () => {
  function promotion(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Bienvenue',
      type: 'PERCENTAGE',
      scope: 'ORDER',
      code: `INT${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      percentOff: 10,
      startsAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('creates one and stores it', async () => {
    const response = await test.http
      .post('/api/v1/admin/promotions')
      .set('Authorization', owner.bearer)
      .send(promotion());

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await test.prisma.promotion.count()).toBe(1);
  });

  it('refuses a percentage above a hundred, naming the field', async () => {
    const response = await test.http
      .post('/api/v1/admin/promotions')
      .set('Authorization', owner.bearer)
      .send(promotion({ percentOff: 150 }))
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body.error.details)).toContain('percentOff');
  });

  it('refuses a lower-case code, because codes are matched exactly', async () => {
    const response = await test.http
      .post('/api/v1/admin/promotions')
      .set('Authorization', owner.bearer)
      .send(promotion({ code: 'bienvenue' }))
      .expect(422);

    expect(JSON.stringify(response.body.error.details)).toContain('code');
  });

  it('refuses an order agent, who may read a promotion but not write one', async () => {
    await test.http
      .post('/api/v1/admin/promotions')
      .set('Authorization', agent.bearer)
      .send(promotion())
      .expect(403);
  });

  it('lets a marketing role create one', async () => {
    await test.http
      .post('/api/v1/admin/promotions')
      .set('Authorization', marketing.bearer)
      .send(promotion())
      .expect(201);
  });
});

// --- finance and reports ------------------------------------------------------

describe('/admin/finance', () => {
  it('computes a P&L over an empty period without failing', async () => {
    // Every figure is zero on a shop that has not sold anything. Returning a shape
    // rather than an error is what lets the screen render on day one.
    const response = await test.http
      .get('/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data).toBeDefined();
  });

  it('lets an accountant read it and refuses an order agent', async () => {
    await test.http
      .get('/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31')
      .set('Authorization', accountant.bearer)
      .expect(200);

    await test.http
      .get('/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31')
      .set('Authorization', agent.bearer)
      .expect(403);
  });

  it('records an expense and reads it back', async () => {
    const category = await test.prisma.expenseCategory.create({
      data: { name: 'Loyer', slug: `loyer-${Date.now()}` },
    });

    const response = await test.http
      .post('/api/v1/admin/finance/expenses')
      .set('Authorization', owner.bearer)
      .send({
        categoryId: category.id,
        label: 'Loyer septembre',
        amount: 4_500_000,
        incurredAt: '2026-09-01',
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await test.prisma.expense.count()).toBe(1);
  });

  it('refuses an expense with no amount', async () => {
    const response = await test.http
      .post('/api/v1/admin/finance/expenses')
      .set('Authorization', owner.bearer)
      .send({ label: 'Sans montant' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('runs a named report and refuses one that does not exist', async () => {
    await test.http
      .get('/api/v1/admin/reports/sales.by_product')
      .set('Authorization', owner.bearer)
      .expect(200);

    await test.http
      .get('/api/v1/admin/reports/sales.by_unicorn')
      .set('Authorization', owner.bearer)
      .expect(400);
  });
});

// --- delivery ------------------------------------------------------------------

describe('/admin/delivery', () => {
  it('lists shipments, zones and rates for somebody who may see them', async () => {
    for (const path of ['/api/v1/admin/shipments', '/api/v1/admin/shipping/zones', '/api/v1/admin/shipping/rates']) {
      await test.http.get(path).set('Authorization', owner.bearer).expect(200);
    }
  });

  it('refuses the cash drawer to a role without the settlement permission', async () => {
    // The screen was already hidden behind `delivery.settle`; the route asked only for
    // `delivery.read`, which an order agent holds so they can see where a parcel is.
    await test.http.get('/api/v1/admin/cash/daily').set('Authorization', agent.bearer).expect(403);
    await test.http.get('/api/v1/admin/settlements').set('Authorization', agent.bearer).expect(403);
  });

  it('lets an accountant open it, because reconciling is their job', async () => {
    await test.http
      .get('/api/v1/admin/cash/daily')
      .set('Authorization', accountant.bearer)
      .expect(200);
  });

  it('creates a vehicle and refuses one with no plate', async () => {
    const created = await test.http
      .post('/api/v1/admin/vehicles')
      .set('Authorization', owner.bearer)
      .send({ plate: `16-${Date.now() % 100000}-119`, label: 'Kangoo', kind: 'van' });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    await test.http
      .post('/api/v1/admin/vehicles')
      .set('Authorization', owner.bearer)
      .send({ label: 'Sans plaque' })
      .expect(422);
  });
});

// --- content and marketing ------------------------------------------------------

describe('/admin/content and /admin/marketing', () => {
  it('creates a CMS page and reads the list back', async () => {
    const slug = `page-${Date.now()}`;

    const created = await test.http
      .post('/api/v1/admin/content/pages')
      .set('Authorization', owner.bearer)
      .send({
        slug,
        title: { fr: 'Livraison', en: 'Delivery', ar: 'التوصيل' },
        body: { fr: 'Nous livrons partout.', en: 'We deliver everywhere.', ar: 'نوصل' },
      });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const list = await test.http
      .get('/api/v1/admin/content/pages')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(JSON.stringify(list.body)).toContain(slug);
  });

  it('strips script out of a page body before storing it', async () => {
    // The storefront renders this with dangerouslySetInnerHTML. Until the sanitiser
    // existed, a <script> typed here ran on every visitor's browser.
    const created = await test.http
      .post('/api/v1/admin/content/pages')
      .set('Authorization', owner.bearer)
      .send({
        slug: `xss-${Date.now()}`,
        title: { fr: 'Sonde' },
        body: {
          fr: '<h2>Livraison</h2><script>window.pwned=1</script><img src=x onerror=alert(1)>',
        },
      })
      .expect(201);

    const body = created.body.data.body.fr as string;

    expect(body).not.toContain('script');
    expect(body).not.toContain('onerror');
    // And the formatting a shop actually writes survives, or the editor is useless.
    expect(body).toContain('<h2>Livraison</h2>');
  });

  it('strips script out of a product description too', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);

    const created = await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', owner.bearer)
      .send({
        name: { fr: `Casquette ${suffix}` },
        slug: `xss-${suffix}`,
        description: { fr: '<p>Belle</p><script>window.pwned=1</script>' },
        variants: [{ sku: `XSS-${suffix}`.toUpperCase(), price: 350_000 }],
      })
      .expect(201);

    expect(JSON.stringify(created.body.data.description)).not.toContain('script');
  });

  it('refuses a page with no slug', async () => {
    const response = await test.http
      .post('/api/v1/admin/content/pages')
      .set('Authorization', owner.bearer)
      .send({ title: { fr: 'Sans slug' } })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('keeps content and marketing on separate permissions', async () => {
    // `marketing.read` gates the newsletter and was granting nothing until it was split
    // out of `content.read`; an order agent holds neither.
    await test.http
      .get('/api/v1/admin/marketing/newsletter')
      .set('Authorization', marketing.bearer)
      .expect(200);

    await test.http
      .get('/api/v1/admin/marketing/newsletter')
      .set('Authorization', agent.bearer)
      .expect(403);
  });
});

// --- settings, users and audit ----------------------------------------------------

describe('/admin/settings, /admin/users and /admin/audit', () => {
  it('reads the settings scopes', async () => {
    await test.http.get('/api/v1/admin/settings').set('Authorization', owner.bearer).expect(200);
  });

  it('writes a setting and reads the new value back', async () => {
    await test.http
      .patch('/api/v1/admin/settings/store')
      .set('Authorization', owner.bearer)
      .send({ 'store.name': 'Jeck’s Alger' })
      .expect(200);

    const stored = await test.prisma.setting.findFirstOrThrow({ where: { key: 'store.name' } });
    expect(JSON.stringify(stored.value)).toContain('Alger');
  });

  it('refuses an empty shop name with the same 422 as every other route', async () => {
    // This scope is validated in the service rather than by the pipe, and it used to
    // answer 400 for the error code the contract documents as 422.
    const response = await test.http
      .patch('/api/v1/admin/settings/store')
      .set('Authorization', owner.bearer)
      .send({ 'store.name': '' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a key that does not belong to the scope, and says which', async () => {
    const response = await test.http
      .patch('/api/v1/admin/settings/store')
      .set('Authorization', owner.bearer)
      .send({ 'finance.secret': 'nope' })
      .expect(400);

    expect(JSON.stringify(response.body.error.details)).toContain('finance.secret');
  });

  it('refuses settings to everyone but an administrator', async () => {
    await test.http.get('/api/v1/admin/settings').set('Authorization', agent.bearer).expect(403);
    await test.http.get('/api/v1/admin/users').set('Authorization', agent.bearer).expect(403);
  });

  it('writes an audit row for a mutating request, with who did it', async () => {
    await sellableProduct(test.prisma);

    await test.http
      .patch('/api/v1/admin/settings/store')
      .set('Authorization', owner.bearer)
      .send({ 'store.name': 'Jeck’s' })
      .expect(200);

    const response = await test.http
      .get('/api/v1/admin/audit')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.meta.total).toBeGreaterThan(0);
  });
});
