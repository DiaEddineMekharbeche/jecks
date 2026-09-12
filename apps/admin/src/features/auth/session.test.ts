import { PERMISSIONS, ROLE_PERMISSIONS, RoleSlug, type Permission } from '@jecks/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NAVIGATION } from '@/app/navigation';
import { useSession } from './session';

/**
 * The permission check the whole admin is gated on.
 *
 * Every nav entry and every route guard calls `can`. It is a handful of lines, which is
 * exactly why it deserves a test: a check this small gets rewritten without thought, and
 * an `every` that became a `some` would open every screen to everybody while looking
 * entirely reasonable.
 *
 * These also assert that the navigation only names permissions that exist, so a typo
 * cannot quietly hide a whole module from the people who should see it.
 */

function signedInWith(permissions: Permission[]): void {
  useSession.setState({
    status: 'authenticated',
    user: {
      id: 'user-1',
      name: 'Test',
      email: 'test@jecks.dz',
      roles: ['owner'],
      permissions,
    } as never,
  });
}

beforeEach(() => {
  useSession.setState({ status: 'loading', user: null });
});

describe('can', () => {
  it('says no to everybody before the session has loaded', () => {
    // The boot splash renders in this window; a `can` that answered yes would flash a
    // screen the user may not be allowed to see.
    expect(useSession.getState().can('orders.read')).toBe(false);
  });

  it('says yes only for a permission the user actually holds', () => {
    signedInWith(['orders.read', 'customers.read']);

    expect(useSession.getState().can('orders.read')).toBe(true);
    expect(useSession.getState().can('finance.read')).toBe(false);
  });

  it('requires every permission when given several, not any of them', () => {
    // The distinction that matters: `some` here would grant a screen needing both to
    // somebody holding one.
    signedInWith(['orders.read']);

    expect(useSession.getState().can('orders.read', 'orders.write')).toBe(false);

    signedInWith(['orders.read', 'orders.write']);
    expect(useSession.getState().can('orders.read', 'orders.write')).toBe(true);
  });

  it('says yes when asked for nothing, so an ungated screen renders', () => {
    signedInWith([]);

    expect(useSession.getState().can()).toBe(true);
  });

  it('says no for a signed-in user with no permissions at all', () => {
    signedInWith([]);

    expect(useSession.getState().can('orders.read')).toBe(false);
  });
});

describe('the navigation', () => {
  it('names only permissions that exist', () => {
    // A typo would hide the module from everybody, which reads as a missing feature.
    const known = new Set<string>(PERMISSIONS);
    const invented = NAVIGATION.filter((item) => !known.has(item.permission));

    expect(invented.map((item) => `${item.key} → ${item.permission}`)).toEqual([]);
  });

  it('gives an owner every entry', () => {
    signedInWith([...ROLE_PERMISSIONS[RoleSlug.OWNER]]);
    const can = useSession.getState().can;

    expect(NAVIGATION.filter((item) => can(item.permission))).toHaveLength(NAVIGATION.length);
  });

  it('gives an order agent the screens they work on and no others', () => {
    signedInWith([...ROLE_PERMISSIONS[RoleSlug.ORDER_AGENT]]);
    const can = useSession.getState().can;

    const visible = NAVIGATION.filter((item) => can(item.permission)).map((item) => item.key);

    expect(visible).toContain('orders');
    expect(visible).toContain('customers');
    // Finance and settings are the two an agent must never see, per acceptance
    // criterion 6 — and the API refuses them as well, which the integration suite
    // asserts separately. Both locks, not one.
    expect(visible).not.toContain('finance');
    expect(visible).not.toContain('settings');
  });

  it('gives a driver nothing, because their screen is not in this menu', () => {
    signedInWith([...ROLE_PERMISSIONS[RoleSlug.DRIVER]]);
    const can = useSession.getState().can;

    const visible = NAVIGATION.filter((item) => can(item.permission)).map((item) => item.key);

    expect(visible).toEqual(['orders']);
  });

  it('gives an accountant the books and not the catalogue', () => {
    signedInWith([...ROLE_PERMISSIONS[RoleSlug.ACCOUNTANT]]);
    const can = useSession.getState().can;

    const visible = NAVIGATION.filter((item) => can(item.permission)).map((item) => item.key);

    expect(visible).toContain('finance');
    expect(visible).not.toContain('catalog');
  });

  it('has a unique key per entry, because the keys drive badge counters', () => {
    const keys = NAVIGATION.map((item) => item.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
