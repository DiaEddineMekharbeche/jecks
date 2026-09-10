import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import type { AuthTokens, SessionUser } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard.js';

/** How long an OTP stays usable, and how many wrong tries before it dies. */
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
/** Brute-force protection on staff sign-in — PRD Section 10.8. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface IssuedSession {
  tokens: AuthTokens;
  user: SessionUser;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
  ) {}

  // --- staff -----------------------------------------------------------------

  async loginStaff(
    email: string,
    password: string,
    totp: string | undefined,
    context: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    // Same message whether the address is unknown or the password is wrong, so the
    // response cannot be used to enumerate staff accounts.
    const invalid = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Wrong e-mail or password',
    });

    if (!user || !user.passwordHash || user.deletedAt || !user.active) throw invalid;

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Too many attempts. Try again in a few minutes.',
      });
    }

    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
      throw invalid;
    }

    if (user.twoFactorEnabled) {
      if (!totp) {
        throw new UnauthorizedException({
          code: 'TOTP_REQUIRED',
          message: 'Enter the 6-digit code from your authenticator app',
        });
      }
      const valid =
        user.twoFactorSecret != null &&
        authenticator.check(totp, user.twoFactorSecret);
      if (!valid) {
        throw new UnauthorizedException({ code: 'TOTP_INVALID', message: 'That code is not valid' });
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueSession(user.id, context);
  }

  // --- customer OTP ----------------------------------------------------------

  /**
   * Issues a one-time code for a phone number. Returns the code only outside
   * production so the dev checkout flow does not need a live SMS gateway.
   */
  async requestOtp(
    phone: string,
    purpose: string,
    ip?: string,
  ): Promise<{ expiresAt: Date; devCode?: string }> {
    const recent = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent >= 2) {
      throw new BadRequestException({
        code: 'OTP_RATE_LIMITED',
        message: 'Wait a minute before asking for another code',
      });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Any earlier live code for this phone is spent, so only the newest one works.
    await this.prisma.otpCode.updateMany({
      where: { phone, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.otpCode.create({
      data: { phone, purpose, codeHash: await hash(code), expiresAt, ip },
    });

    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (!isProduction) this.logger.log(`OTP for ${phone}: ${code}`);

    // The code goes out through the notification queue like every other message, so it
    // uses the shop's own gateway and its own template. `test: true` skips the dedupe
    // key: a second code for the same phone is a new message, not a retry of the first.
    void this.queue
      .enqueue('notifications', 'notification.dispatch', {
        event: 'auth.otp',
        recipient: phone,
        test: true,
        variables: { code, minutes: String(Math.round(OTP_TTL_MS / 60_000)) },
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not queue the sign-in code: ${String(error)}`);
      });

    // Outside production the code comes back in the response too, so a developer can
    // sign in with no SMS gateway configured at all.
    return { expiresAt, ...(isProduction ? {} : { devCode: code }) };
  }

  async verifyOtp(
    phone: string,
    code: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const record = await this.prisma.otpCode.findFirst({
      where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    const invalid = new UnauthorizedException({
      code: 'OTP_INVALID',
      message: 'That code is wrong or has expired',
    });
    if (!record) throw invalid;

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      throw invalid;
    }

    const ok = await verify(record.codeHash, code).catch(() => false);
    if (!ok) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    await this.prisma.otpCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    const user = await this.findOrCreateCustomerUser(phone);
    return this.issueSession(user.id, context);
  }

  /**
   * A phone that has ordered as a guest already has a `customers` row but no login.
   * Signing in attaches a `users` row to it rather than creating a second identity.
   */
  private async findOrCreateCustomerUser(phone: string): Promise<{ id: string }> {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) return existing;

    const customer = await this.prisma.customer.findUnique({ where: { phone } });
    const user = await this.prisma.user.create({
      data: {
        type: 'CUSTOMER',
        phone,
        name: customer?.fullName ?? 'Client',
        email: customer?.email ?? null,
      },
    });

    if (customer) {
      await this.prisma.customer.update({ where: { id: customer.id }, data: { userId: user.id } });
    } else {
      await this.prisma.customer.create({
        data: { phone, fullName: 'Client', userId: user.id },
      });
    }
    return user;
  }

  // --- sessions --------------------------------------------------------------

  async issueSession(
    userId: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const user = await this.loadSessionUser(userId);
    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = parseDays(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d');

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        ip: context.ip?.slice(0, 64),
        userAgent: context.userAgent?.slice(0, 400),
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });

    const tokens = await this.signAccessToken(user, session.id);
    return { tokens, user, refreshToken };
  }

  /**
   * Rotates the refresh token. A token presented twice means it was stolen or replayed,
   * so the whole session chain is revoked rather than silently re-issued.
   */
  async refresh(
    refreshToken: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const hashValue = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hashValue } });

    const invalid = new UnauthorizedException({
      code: 'REFRESH_INVALID',
      message: 'Please sign in again',
    });
    if (!session) throw invalid;

    if (session.revokedAt || session.expiresAt < new Date()) {
      if (session.replacedById) {
        this.logger.warn(`Refresh token replay for user ${session.userId}; revoking all sessions`);
        await this.prisma.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw invalid;
    }

    const issued = await this.issueSession(session.userId, context);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return issued;
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async loadSessionUser(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user || !user.active || user.deletedAt) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue' });
    }

    const roles = user.roles.map((link) => link.role.slug);
    const permissions = [
      ...new Set(
        user.roles.flatMap((link) => link.role.permissions.map((rp) => rp.permission.key)),
      ),
    ];

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      type: user.type,
      roles,
      permissions,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }

  private async signAccessToken(user: SessionUser, sessionId: string): Promise<AuthTokens> {
    const ttl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const payload: AccessTokenPayload = {
      sub: user.id,
      typ: user.type,
      name: user.name,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      perms: user.permissions,
      sid: sessionId,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ttl,
    });
    return { accessToken, expiresIn: parseSeconds(ttl) };
  }

  // --- two-factor ------------------------------------------------------------

  async beginTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email ?? user.name, "Jeck's", secret);
    // Stored only once the user proves they can produce a code from it.
    return { secret, otpauthUrl };
  }

  async enableTwoFactor(userId: string, secret: string, code: string): Promise<void> {
    if (!authenticator.check(code, secret)) {
      throw new BadRequestException({ code: 'TOTP_INVALID', message: 'That code is not valid' });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret, twoFactorEnabled: true },
    });
  }

  async disableTwoFactor(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: null, twoFactorEnabled: false },
    });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** "30d" -> 30. Only days are used for refresh lifetimes. */
function parseDays(ttl: string): number {
  const match = /^(\d+)d$/.exec(ttl);
  return match ? Number(match[1]) : 30;
}

/** "15m" | "3600s" | "2h" -> seconds, for the client's expiry countdown. */
function parseSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}
