import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/app.js';

/**
 * Every admin route, checked mechanically — PRD Section 5, testing contract.
 *
 * The per-module files below assert on behaviour. This one asserts on something no
 * module owns: that nothing under `/admin` is reachable without a session. A route
 * added next month inherits the check by existing, which a hand-written list would not
 * do — and "somebody forgot the decorator" is exactly the mistake that never shows up
 * in the module's own tests, because those always send a token.
 *
 * The routes come from the router the application actually built, not from a fixture.
 */

interface Route {
  method: string;
  path: string;
}

let test: TestApp;
let routes: Route[];

beforeAll(async () => {
  test = await createTestApp();
  routes = adminRoutes(test);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

/**
 * Reads the Express router the Nest app built.
 *
 * Reaching into the adapter is unpleasant and is the only way to enumerate what was
 * actually registered. The alternative is a list in a file, which is a list that goes
 * stale the first time somebody adds a controller.
 */
function adminRoutes(app: TestApp): Route[] {
  const instance = app.app.getHttpAdapter().getInstance() as {
    _router?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
    router?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
  };

  const stack = instance._router?.stack ?? instance.router?.stack ?? [];
  const found: Route[] = [];

  for (const layer of stack) {
    const path = layer.route?.path;
    if (!path || !path.includes('/admin/')) continue;

    for (const [method, enabled] of Object.entries(layer.route!.methods)) {
      if (enabled) found.push({ method: method.toUpperCase(), path });
    }
  }

  return found;
}

/** Fills `:id` and friends with a syntactically valid uuid that matches nothing. */
function concrete(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-0000-0000-000000000000');
}

describe('the admin surface', () => {
  it('registered a meaningful number of routes, so an empty list cannot pass', () => {
    // Without this, a broken enumerator would make every test below vacuously true.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('refuses every single one of them without a token', async () => {
    const reachable: string[] = [];

    for (const route of routes) {
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
      if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;

      const response = await test.http[method](concrete(route.path)).send({});

      // 401 is the answer. 403 is acceptable too — it means a guard ran and said no.
      // Anything else means an unauthenticated caller got further than the door.
      if (response.status !== 401 && response.status !== 403) {
        reachable.push(`${route.method} ${route.path} → ${response.status}`);
      }
    }

    expect(reachable, `unauthenticated requests got through:\n${reachable.join('\n')}`).toEqual([]);
  }, 120_000);
});
