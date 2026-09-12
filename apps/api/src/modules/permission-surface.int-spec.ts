import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERMISSIONS, RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../testing/app.js';
import { signInAs } from '../testing/auth.js';
import { customer } from '../testing/factories.js';
import { routePermissions, toSurface, type RoutePermissions } from '../testing/route-permissions.js';

/**
 * Who is allowed to reach what — PRD Section 10.3 and acceptance criterion 6.
 *
 * One defect has appeared six times in this codebase: a permission exists in the
 * catalogue, appears on the permission-matrix screen, is respected by the admin
 * navigation, and is demanded by no route. `marketing.read`, `reports.export`,
 * `orders.cancel`, `orders.refund`, `customers.blacklist`, and the cash drawer asking
 * for `delivery.read` when its screen required `delivery.settle`.
 *
 * Every one was found by somebody thinking to look. These tests make the whole surface
 * an artifact that has to be reviewed instead.
 */

// Vitest runs with the package as its working directory.
const SURFACE_FILE = resolve(process.cwd(), 'permission-surface.txt');

/**
 * Permissions enforced somewhere other than a route decorator.
 *
 * Each one needs a reason, because this list is the escape hatch that would otherwise
 * make the "no orphan permission" test meaningless.
 */
const ENFORCED_IN_CODE: Record<string, string> = {
  // The target of the transition decides, not the route: a route-level guard cannot say
  // "this status needs more than the others". See OrdersAdminController.transition.
  'orders.cancel': 'checked in the transition handler against the target status',
  'orders.refund': 'checked in the transition handler against the target status',
};

let test: TestApp;
let routes: RoutePermissions[];

beforeAll(async () => {
  test = await createTestApp();
  routes = routePermissions(test);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

describe('the permission surface', () => {
  it('found the controllers, so nothing below is vacuously true', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('demands a permission on every admin route', () => {
    const unguarded = routes
      .filter((route) => route.path.includes('/admin/'))
      .filter((route) => route.isPublic || route.permissions.length === 0)
      .map((route) => `${route.method} ${route.path}`);

    expect(unguarded, `admin routes with no permission:\n${unguarded.join('\n')}`).toEqual([]);
  });

  it('demands only permissions that exist in the catalogue', () => {
    // A typo silently denies everybody, which looks like a broken feature rather than a
    // broken guard and is diagnosed by reading the source.
    const known = new Set<string>(PERMISSIONS);
    const invented = [
      ...new Set(
        routes.flatMap((route) => route.permissions).filter((permission) => !known.has(permission)),
      ),
    ];

    expect(invented, `permissions no role can ever hold:\n${invented.join('\n')}`).toEqual([]);
  });

  it('leaves no permission in the catalogue that nothing asks for', () => {
    // The sixth instance of this was `customers.blacklist`: the screen offered it, no
    // role was refused by it, and any agent who could fix a typo could ban a customer.
    const demanded = new Set(routes.flatMap((route) => route.permissions));

    const orphans = PERMISSIONS.filter(
      (permission) => !demanded.has(permission) && !(permission in ENFORCED_IN_CODE),
    );

    expect(
      orphans,
      `these grant nothing — either a route should require one, or it should leave the catalogue:\n${orphans.join(
        '\n',
      )}`,
    ).toEqual([]);
  });

  it('matches the reviewed surface, line for line', () => {
    const current = toSurface(routes);

    if (process.env.UPDATE_PERMISSION_SURFACE === '1') {
      writeFileSync(SURFACE_FILE, `${current.join('\n')}\n`, 'utf8');
    }

    expect(
      existsSync(SURFACE_FILE),
      'permission-surface.txt is missing; regenerate with UPDATE_PERMISSION_SURFACE=1',
    ).toBe(true);

    const approved = readFileSync(SURFACE_FILE, 'utf8').trim().split('\n');

    // A diff here is not a failure to fix by regenerating. It is a change to who can
    // reach what, and it belongs in the pull request where somebody reads it.
    expect(current).toEqual(approved);
  });
});

/**
 * The metadata says what a route demands; these prove the guard acts on it.
 *
 * Spot checks rather than the full matrix: the routes that move money, ban people or
 * change who has access. If the guard were bypassed entirely, every one of these would
 * answer 200 and the tests above would still pass.
 */
describe('the guard enforces what the metadata declares', () => {
  it('refuses an order agent everything that touches money or identity', async () => {
    await resetData(test.prisma);
    const agent = await signInAs(test, RoleSlug.ORDER_AGENT);

    const forbidden = [
      '/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31',
      '/api/v1/admin/finance/expenses',
      '/api/v1/admin/cash/daily',
      '/api/v1/admin/settlements',
      '/api/v1/admin/settings',
      '/api/v1/admin/users',
      '/api/v1/admin/roles',
      '/api/v1/admin/audit',
      '/api/v1/admin/backups',
    ];

    const reachable: string[] = [];
    for (const path of forbidden) {
      const response = await test.http.get(path).set('Authorization', agent.bearer);
      if (response.status !== 403) reachable.push(`${path} → ${response.status}`);
    }

    expect(reachable, `an order agent got through:\n${reachable.join('\n')}`).toEqual([]);
  });

  it('refuses an agent the ban button while leaving them the edit button', async () => {
    await resetData(test.prisma);
    const agent = await signInAs(test, RoleSlug.ORDER_AGENT);
    const target = await customer(test.prisma, { phone: '+213661777001' });

    // Correcting a phone number is the job.
    await test.http
      .patch(`/api/v1/admin/customers/${target.id}`)
      .set('Authorization', agent.bearer)
      .send({ fullName: 'Nom corrigé' })
      .expect(200);

    // Refusing somebody's orders for ever is not.
    await test.http
      .post(`/api/v1/admin/customers/${target.id}/blacklist`)
      .set('Authorization', agent.bearer)
      .send({ blacklisted: true, reason: 'non' })
      .expect(403);

    const after = await test.prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.blacklisted).toBe(false);
  });

  it('lets a manager ban, because somebody has to be able to', async () => {
    await resetData(test.prisma);
    const manager = await signInAs(test, RoleSlug.MANAGER);
    const target = await customer(test.prisma, { phone: '+213661777002' });

    await test.http
      .post(`/api/v1/admin/customers/${target.id}/blacklist`)
      .set('Authorization', manager.bearer)
      .send({ blacklisted: true, reason: 'Commandes fantômes répétées' })
      .expect(201);

    const after = await test.prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.blacklisted).toBe(true);
  });

  it('gives an accountant the books and not the catalogue', async () => {
    await resetData(test.prisma);
    const accountant = await signInAs(test, RoleSlug.ACCOUNTANT);

    await test.http
      .get('/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-01-31')
      .set('Authorization', accountant.bearer)
      .expect(200);

    await test.http
      .post('/api/v1/admin/products')
      .set('Authorization', accountant.bearer)
      .send({ name: { fr: 'Non' }, slug: 'non', variants: [{ sku: 'NON-1', price: 1000 }] })
      .expect(403);
  });
});
