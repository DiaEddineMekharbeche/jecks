import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_PERMISSIONS, RoleSlug, type Permission } from '@jecks/shared';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TestApp } from './app.js';

/**
 * Staff accounts and bearer tokens for the integration suite.
 *
 * Tokens come from the real sign-in route rather than from signing a JWT here. That is
 * the point of an integration test: a token this suite mints itself would prove the
 * guard reads a claim, not that a person who signs in can use the application.
 */

const PASSWORD = 'Integration1!';

/** Makes sure the roles and permissions the guard reads actually exist. */
export async function ensureRoles(prisma: PrismaService): Promise<void> {
  const existing = await prisma.permission.count();

  if (existing === 0) {
    await prisma.permission.createMany({
      data: PERMISSIONS.map((key) => ({ key, group: key.split('.')[0] ?? 'other' })),
      skipDuplicates: true,
    });
  }

  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  );

  for (const slug of Object.values(RoleSlug)) {
    const role = await prisma.role.upsert({
      where: { slug },
      create: { slug, name: { fr: slug, en: slug, ar: slug }, isSystem: true },
      update: {},
    });

    const grants = ROLE_PERMISSIONS[slug] ?? [];
    await prisma.rolePermission.createMany({
      data: grants
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
}

/**
 * A signed-in staff member with the given role, and the header to act as them.
 *
 * The role is the real one from the catalogue, so a test that says "an order agent"
 * gets exactly the permissions the shop grants an order agent — and fails the day
 * somebody widens them.
 */
export async function signInAs(
  test: TestApp,
  role: RoleSlug,
): Promise<{ userId: string; email: string; bearer: string }> {
  await ensureRoles(test.prisma);

  const email = `${role}-${randomUUID().slice(0, 8)}@jecks.test`;
  const passwordHash = await hash(PASSWORD);

  const user = await test.prisma.user.create({
    data: { email, name: `Test ${role}`, passwordHash, type: 'STAFF' },
  });

  const roleRow = await test.prisma.role.findUniqueOrThrow({ where: { slug: role } });
  await test.prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });

  const response = await test.http
    .post('/api/v1/auth/staff/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const token = response.body?.data?.accessToken;
  if (!token) throw new Error(`Sign-in returned no token: ${JSON.stringify(response.body)}`);

  return { userId: user.id, email, bearer: `Bearer ${token}` };
}

/** Every permission a role actually holds, for asserting on the isolation tests. */
export function permissionsOf(role: RoleSlug): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
