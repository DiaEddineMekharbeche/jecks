import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../common/decorators/auth.decorators.js';
import type { TestApp } from './app.js';

/**
 * What each route actually demands — PRD Section 10.3.
 *
 * Read from the metadata the decorators set, not from a list somebody maintains. The
 * recurring defect in this codebase has been a permission that exists, is granted to
 * roles, is respected by the screen, and is asked for by no route: `marketing.read`,
 * `reports.export`, `orders.cancel`, `orders.refund`, and the cash drawer asking for
 * `delivery.read` when the screen behind it required `delivery.settle`. Five times.
 *
 * None of those is visible from the outside. A route that asks for too little answers
 * 200 to exactly the people it should answer 200 to, plus a few more, and nothing looks
 * wrong until somebody thinks to check.
 */

export interface RoutePermissions {
  method: string;
  path: string;
  /** Every permission the route requires. Empty means it requires none. */
  permissions: string[];
  /** True when the route is explicitly marked reachable without a token. */
  isPublic: boolean;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

/**
 * Walks the controllers Nest registered and reads each handler's metadata.
 *
 * Class-level decorators are the fallback, the way the guard resolves them: a
 * `@RequirePermissions` on the controller applies to every method that does not set its
 * own, so reading only the method would report routes as unguarded when they are not.
 */
export function routePermissions(app: TestApp): RoutePermissions[] {
  // `ModulesContainer` rather than `DiscoveryService`, which needs its own module
  // imported — and the harness must build the application exactly as production does.
  const modules = app.app.get(ModulesContainer);
  const reflector = app.app.get(Reflector);
  const scanner = new MetadataScanner();

  const routes: RoutePermissions[] = [];
  const controllers = [...modules.values()].flatMap((module) => [...module.controllers.values()]);

  for (const wrapper of controllers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const prefix = normalise(reflector.get<string>(PATH_METADATA, metatype) ?? '');
    const classPermissions = reflector.get<string[]>(PERMISSIONS_KEY, metatype) ?? [];
    const classPublic = reflector.get<boolean>(IS_PUBLIC_KEY, metatype) ?? false;

    const prototype = Object.getPrototypeOf(instance) as object;

    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = (instance as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;

      const methodPath = reflector.get<string>(PATH_METADATA, handler);
      if (methodPath === undefined) continue;

      const verb = reflector.get<number>(METHOD_METADATA, handler);

      routes.push({
        method: METHOD_NAMES[verb] ?? String(verb),
        path: join(prefix, normalise(methodPath)),
        permissions: reflector.get<string[]>(PERMISSIONS_KEY, handler) ?? classPermissions,
        isPublic: reflector.get<boolean>(IS_PUBLIC_KEY, handler) ?? classPublic,
      });
    }
  }

  return routes.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/** `admin/orders` and `/admin/orders/` both become `admin/orders`. */
function normalise(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function join(prefix: string, suffix: string): string {
  return `/${[prefix, suffix].filter(Boolean).join('/')}`;
}

/** One line per route, in a stable order, for comparing against the committed surface. */
export function toSurface(routes: RoutePermissions[]): string[] {
  return routes.map(
    (route) =>
      `${route.method} ${route.path} → ${
        route.isPublic ? 'public' : route.permissions.join(' + ') || 'AUTHENTICATED'
      }`,
  );
}
