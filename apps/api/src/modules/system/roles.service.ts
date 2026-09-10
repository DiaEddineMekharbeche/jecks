import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  PERMISSIONS,
  SYSTEM_ERRORS,
  type Permission,
  type PermissionDto,
  type RoleDto,
  type RoleInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Roles and the permission matrix — PRD F-AD-92, acceptance criterion 6.
 *
 * Seeded roles are `isSystem`: their permissions can be edited, because a shop may
 * decide its managers should see finance after all, but they cannot be renamed or
 * deleted, because the code and the seed refer to them by slug.
 */

const INCLUDE = {
  permissions: { include: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

type RoleRecord = Prisma.RoleGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<RoleDto[]> {
    const rows = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { slug: 'asc' }],
      include: INCLUDE,
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<RoleDto> {
    const row = await this.prisma.role.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found' });
    return toDto(row);
  }

  /** The catalogue the matrix draws its columns from, grouped as the UI shows them. */
  async permissions(): Promise<PermissionDto[]> {
    const rows = await this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
    const byKey = new Map(rows.map((row) => [row.key, row]));

    // The code's list wins over the table: a permission the seed has not written yet
    // must still appear, or a new feature is ungrantable until someone reseeds.
    return PERMISSIONS.map((key) => ({
      key,
      group: byKey.get(key)?.group ?? key.split('.')[0] ?? 'other',
      description: byKey.get(key)?.description ?? null,
    }));
  }

  async create(input: RoleInput): Promise<RoleDto> {
    const clash = await this.prisma.role.findUnique({ where: { slug: input.slug } });
    if (clash) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: `A role with the key "${input.slug}" already exists`,
        details: { field: 'slug' },
      });
    }

    const created = await this.prisma.role.create({
      data: {
        slug: input.slug,
        name: input.name as Prisma.InputJsonValue,
        description: input.description ?? null,
        isSystem: false,
      },
      select: { id: true },
    });

    await this.setPermissions(created.id, input.permissions);
    return this.get(created.id);
  }

  async update(id: string, input: RoleInput): Promise<RoleDto> {
    const role = await this.requireRole(id);

    if (role.isSystem && role.slug !== input.slug) {
      throw new ConflictException({
        code: SYSTEM_ERRORS.ROLE_IS_SYSTEM,
        message: 'A built-in role cannot be renamed; its permissions can still be changed',
        details: { slug: role.slug },
      });
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        slug: input.slug,
        name: input.name as Prisma.InputJsonValue,
        description: input.description ?? null,
      },
    });

    await this.setPermissions(id, input.permissions);
    return this.get(id);
  }

  /** Permission-only update, which is what the matrix checkboxes send. */
  async updatePermissions(id: string, permissions: Permission[]): Promise<RoleDto> {
    await this.requireRole(id);
    await this.setPermissions(id, permissions);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.requireRole(id);

    if (role.isSystem) {
      throw new ConflictException({
        code: SYSTEM_ERRORS.ROLE_IS_SYSTEM,
        message: 'Built-in roles cannot be deleted',
        details: { slug: role.slug },
      });
    }

    const users = await this.prisma.userRole.count({ where: { roleId: id } });
    if (users > 0) {
      throw new ConflictException({
        code: SYSTEM_ERRORS.ROLE_IN_USE,
        message: `${users} staff member(s) still hold this role`,
        details: { userCount: users },
      });
    }

    await this.prisma.role.delete({ where: { id } });
  }

  /**
   * Replaces the grants wholesale. Diffing would be fewer writes and one more thing to
   * get wrong; a role has tens of permissions, not thousands.
   */
  private async setPermissions(roleId: string, keys: Permission[]): Promise<void> {
    const rows = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: rows.map((row) => ({ roleId, permissionId: row.id })),
        skipDuplicates: true,
      }),
    ]);
  }

  private async requireRole(id: string): Promise<RoleRecord> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: INCLUDE });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found' });
    return role;
  }
}

function toDto(row: RoleRecord): RoleDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name as Translated,
    description: row.description,
    isSystem: row.isSystem,
    permissions: row.permissions.map((link) => link.permission.key as Permission),
    userCount: row._count.users,
  };
}
