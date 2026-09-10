import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@jecks/db';
import {
  SYSTEM_ERRORS,
  type AcceptInvitationInput,
  type AdminListQuery,
  type AdminListResponse,
  type StaffInvitationRow,
  type StaffInviteInput,
  type StaffPasswordInput,
  type StaffRow,
  type StaffUpdateInput,
  type Translated,
} from '@jecks/shared';
import { andWhere, listResponse, planList, searchFilter } from '../../common/list/list.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Staff accounts and invitations — PRD F-AD-92.
 *
 * An account is never created with a password chosen by someone else. The owner invites
 * an address, the invitee follows a single-use link and sets their own password. That
 * removes the "temporary password sent over WhatsApp" step which is how small teams
 * actually leak access.
 */

const SORTABLE: Record<string, string> = {
  name: 'name',
  email: 'email',
  createdAt: 'createdAt',
  lastLoginAt: 'lastLoginAt',
};

const INVITATION_TTL_HOURS = 72;

const INCLUDE = {
  roles: { include: { role: { select: { id: true, slug: true, name: true } } } },
  sessions: {
    where: { revokedAt: null, expiresAt: { gt: new Date(0) } },
    select: { id: true, expiresAt: true },
  },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // --- staff ----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: { active?: string[]; roleId?: string[] },
  ): Promise<AdminListResponse<StaffRow>> {
    const where = andWhere(
      { type: 'STAFF', deletedAt: null },
      filters.active?.length ? { active: filters.active.includes('true') } : undefined,
      filters.roleId?.length ? { roles: { some: { roleId: { in: filters.roleId } } } } : undefined,
      searchFilter(query.q, ['name', 'email', 'phone']),
    ) as Prisma.UserWhereInput;

    const plan = planList(query, SORTABLE, 'name');
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: INCLUDE,
        orderBy: plan.orderBy as Prisma.UserOrderByWithRelationInput,
        skip: plan.skip,
        take: plan.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return listResponse(query, rows.map(toRow), total);
  }

  async get(id: string): Promise<StaffRow> {
    const row = await this.prisma.user.findFirst({
      where: { id, type: 'STAFF', deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Staff member not found' });
    return toRow(row);
  }

  async update(id: string, input: StaffUpdateInput, actorId: string): Promise<StaffRow> {
    const current = await this.get(id);

    if (input.active === false) {
      if (id === actorId) {
        throw new ConflictException({
          code: SYSTEM_ERRORS.SELF_DEACTIVATE,
          message: 'You cannot deactivate your own account',
        });
      }
      await this.assertNotLastOwner(id);
    }

    if (input.roleIds && current.roles.some((role) => role.slug === 'owner')) {
      const keepsOwner = await this.roleSlugs(input.roleIds).then((slugs) => slugs.includes('owner'));
      if (!keepsOwner) await this.assertNotLastOwner(id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          locale: input.locale,
          active: input.active,
        },
      });

      if (input.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({ userId: id, roleId })),
          skipDuplicates: true,
        });
      }

      // Deactivating without cutting the sessions leaves a valid refresh cookie in the
      // wild for up to thirty days, which is not what "deactivate" means to anyone.
      if (input.active === false) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    return this.get(id);
  }

  /** Ends every session; the next request from that browser lands on the sign-in page. */
  async revokeSessions(id: string): Promise<{ revoked: number }> {
    const result = await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  /**
   * Clears the second factor so a locked-out colleague can enrol again. Also drops
   * their sessions: whoever asked for this could not sign in, so nothing of theirs
   * should stay signed in either.
   */
  async resetTwoFactor(id: string): Promise<StaffRow> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { twoFactorEnabled: false, twoFactorSecret: null, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return this.get(id);
  }

  async setPassword(id: string, input: StaffPasswordInput): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await hash(input.password), failedLoginCount: 0, lockedUntil: null },
    });
    return { ok: true };
  }

  /** Soft delete. The audit trail and every order this agent touched must survive. */
  async deactivate(id: string, actorId: string): Promise<void> {
    if (id === actorId) {
      throw new ConflictException({
        code: SYSTEM_ERRORS.SELF_DEACTIVATE,
        message: 'You cannot remove your own account',
      });
    }
    await this.assertNotLastOwner(id);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // --- invitations ----------------------------------------------------------

  async listInvitations(): Promise<StaffInvitationRow[]> {
    const rows = await this.prisma.staffInvitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        role: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });

    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      roleId: row.roleId,
      roleName: row.role.name as Translated,
      invitedByName: row.invitedBy.name,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      expired: !row.acceptedAt && row.expiresAt < now,
    }));
  }

  /**
   * Creates an invitation and returns the one-time link.
   *
   * Only the hash is stored, so a database dump does not hand out accounts. The plain
   * token is returned to the caller once, for the notifier to send and for the owner to
   * copy if e-mail is not configured yet.
   */
  async invite(
    input: StaffInviteInput,
    invitedById: string,
  ): Promise<{ invitation: StaffInvitationRow; token: string }> {
    const existing = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Someone already uses that e-mail address',
        details: { field: 'email' },
      });
    }

    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) {
      throw new BadRequestException({ code: 'NOT_FOUND', message: 'That role no longer exists' });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000);

    // Re-inviting the same address replaces the pending invitation rather than leaving
    // two live links, only one of which the recipient will use.
    await this.prisma.staffInvitation.deleteMany({
      where: { email: input.email, acceptedAt: null },
    });

    const created = await this.prisma.staffInvitation.create({
      data: {
        email: input.email,
        name: input.name,
        tokenHash: hashToken(token),
        roleId: input.roleId,
        invitedById,
        expiresAt,
      },
      select: { id: true },
    });

    const invitations = await this.listInvitations();
    const invitation = invitations.find((row) => row.id === created.id)!;
    return { invitation, token };
  }

  async revokeInvitation(id: string): Promise<void> {
    await this.prisma.staffInvitation.delete({ where: { id } });
  }

  /** Public: the invitee sets their own password and the account comes into being. */
  async acceptInvitation(input: AcceptInvitationInput): Promise<{ email: string }> {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
      throw new BadRequestException({
        code: SYSTEM_ERRORS.INVITATION_INVALID,
        message: 'That invitation link is no longer valid. Ask for a new one.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          type: 'STAFF',
          name: invitation.name,
          email: invitation.email,
          passwordHash: await hash(input.password),
          active: true,
        },
        select: { id: true },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: invitation.roleId } });
      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });

    return { email: invitation.email };
  }

  // --- helpers --------------------------------------------------------------

  private async roleSlugs(roleIds: string[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { slug: true },
    });
    return roles.map((role) => role.slug);
  }

  /**
   * A shop with no owner cannot grant anyone the permissions needed to make one. The
   * check is a count of *other* active owners, not of owners including this one.
   */
  private async assertNotLastOwner(userId: string): Promise<void> {
    const isOwner = await this.prisma.userRole.count({
      where: { userId, role: { slug: 'owner' } },
    });
    if (isOwner === 0) return;

    const others = await this.prisma.user.count({
      where: {
        id: { not: userId },
        type: 'STAFF',
        active: true,
        deletedAt: null,
        roles: { some: { role: { slug: 'owner' } } },
      },
    });

    if (others === 0) {
      throw new ConflictException({
        code: SYSTEM_ERRORS.LAST_OWNER,
        message: 'This is the last owner account. Promote someone else first.',
      });
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toRow(row: UserRecord): StaffRow {
  const now = Date.now();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    locale: row.locale,
    active: row.active,
    twoFactorEnabled: row.twoFactorEnabled,
    roles: row.roles.map((link) => ({
      id: link.role.id,
      slug: link.role.slug,
      name: link.role.name as Translated,
    })),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    activeSessions: row.sessions.filter((session) => session.expiresAt.getTime() > now).length,
    createdAt: row.createdAt.toISOString(),
  };
}
