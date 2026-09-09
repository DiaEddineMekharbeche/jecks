/**
 * RBAC permission catalogue — PRD Section 10.3 (`orders.update`, `finance.read`…)
 * and the roles matrix of F-AD-92.
 *
 * The seed writes these strings into `permissions` and links them to roles, and the
 * API's `PermissionsGuard` reads them off route metadata. Adding a permission means
 * adding it here, granting it below, and re-running the seed.
 */

import { RoleSlug } from './index.js';

export const PERMISSIONS = [
  // Catalog
  'catalog.read',
  'catalog.write',
  'catalog.delete',
  'reviews.moderate',
  // Inventory
  'inventory.read',
  'inventory.write',
  'purchasing.read',
  'purchasing.write',
  // Orders
  'orders.read',
  'orders.write',
  'orders.transition',
  'orders.cancel',
  'orders.refund',
  'orders.documents',
  // Customers
  'customers.read',
  'customers.write',
  'customers.blacklist',
  // Promotions & marketing
  'promotions.read',
  'promotions.write',
  'content.read',
  'content.write',
  'marketing.read',
  'marketing.write',
  // Delivery
  'delivery.read',
  'delivery.write',
  'delivery.dispatch',
  'delivery.own_runs', // a driver sees only their own run — PRD acceptance criterion 6
  'delivery.settle',
  // Finance
  'finance.read',
  'finance.write',
  'reports.read',
  'reports.export',
  // System
  'settings.read',
  'settings.write',
  'users.read',
  'users.write',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/** Everything except finance, settings and user management — PRD Section 2 (Manager). */
const MANAGER: Permission[] = ALL.filter(
  (p) =>
    !p.startsWith('finance.') &&
    !p.startsWith('settings.') &&
    !p.startsWith('users.') &&
    p !== 'audit.read',
);

export const ROLE_PERMISSIONS: Record<RoleSlug, readonly Permission[]> = {
  [RoleSlug.OWNER]: ALL,
  [RoleSlug.MANAGER]: MANAGER,
  [RoleSlug.ORDER_AGENT]: [
    'orders.read',
    'orders.write',
    'orders.transition',
    'orders.cancel',
    'customers.read',
    'customers.write',
    'catalog.read',
    'inventory.read',
    'promotions.read',
    'delivery.read',
  ],
  [RoleSlug.WAREHOUSE]: [
    'orders.read',
    'orders.transition',
    'orders.documents',
    'inventory.read',
    'inventory.write',
    'purchasing.read',
    'catalog.read',
    'delivery.read',
  ],
  [RoleSlug.DRIVER]: ['delivery.own_runs', 'orders.read'],
  [RoleSlug.MARKETING]: [
    'catalog.read',
    'catalog.write',
    'promotions.read',
    'promotions.write',
    'content.read',
    'content.write',
    'marketing.read',
    'marketing.write',
    'reports.read',
    'customers.read',
    'reviews.moderate',
  ],
  [RoleSlug.ACCOUNTANT]: [
    'finance.read',
    'finance.write',
    'reports.read',
    'reports.export',
    'orders.read',
    'delivery.read',
    'delivery.settle',
    'inventory.read',
    'purchasing.read',
  ],
};

/** Human labels for the permission matrix screen (F-AD-92). */
export const PERMISSION_GROUPS: Record<string, readonly Permission[]> = {
  Catalog: ['catalog.read', 'catalog.write', 'catalog.delete', 'reviews.moderate'],
  Inventory: ['inventory.read', 'inventory.write', 'purchasing.read', 'purchasing.write'],
  Orders: [
    'orders.read',
    'orders.write',
    'orders.transition',
    'orders.cancel',
    'orders.refund',
    'orders.documents',
  ],
  Customers: ['customers.read', 'customers.write', 'customers.blacklist'],
  Marketing: [
    'promotions.read',
    'promotions.write',
    'content.read',
    'content.write',
    'marketing.read',
    'marketing.write',
  ],
  Delivery: [
    'delivery.read',
    'delivery.write',
    'delivery.dispatch',
    'delivery.own_runs',
    'delivery.settle',
  ],
  Finance: ['finance.read', 'finance.write', 'reports.read', 'reports.export'],
  System: ['settings.read', 'settings.write', 'users.read', 'users.write', 'audit.read'],
};
