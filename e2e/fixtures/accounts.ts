/**
 * Who the tests sign in as.
 *
 * These are the accounts `pnpm db:seed` creates. The role isolation spec depends on
 * them having exactly the permissions the seed grants, which is the point: if somebody
 * widens the agent role, a test fails rather than a customer's finances becoming
 * readable by whoever answers the phone.
 */
export const ACCOUNTS = {
  owner: {
    email: process.env.SEED_OWNER_EMAIL ?? 'owner@jecks.dz',
    password: process.env.SEED_OWNER_PASSWORD ?? 'Jecks2026!',
  },
  agent: { email: 'agent@jecks.dz', password: 'Jecks2026!' },
  manager: { email: 'manager@jecks.dz', password: 'Jecks2026!' },
} as const;

export const URLS = {
  storefront: process.env.STOREFRONT_URL ?? 'http://localhost:3000',
  admin: process.env.ADMIN_URL ?? 'http://localhost:5174',
  api: process.env.API_URL ?? 'http://localhost:4000/api/v1',
} as const;

/** A phone number no seeded customer owns, so each run starts clean. */
export function uniquePhone(): string {
  const tail = String(Date.now()).slice(-8);
  return `+2135${tail}`;
}
