import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SECRET_MASK,
  SECRET_SETTING_KEYS,
  SETTING_SCOPES,
  SYSTEM_ERRORS,
  settingScopeSchemas,
  type SettingScope,
  type SettingsScopeDto,
} from '@jecks/shared';
import type { Prisma } from '@jecks/db';
import { decryptSecret, encryptSecret, isEncrypted } from '../../common/crypto/secrets.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Settings writes — PRD F-AD-91.
 *
 * Reads and writes go by scope, not by key, because a scope is what a screen section
 * saves and what one audit row should describe. A partial payload is allowed: the admin
 * sends what changed, and the scope schema validates those fields against their own
 * rules rather than demanding the whole section back.
 *
 * Secrets never leave the server. They are encrypted with `CREDENTIALS_KEY` on the way
 * in, returned as a mask on the way out, and a mask sent back means "leave it alone" —
 * which is what makes the form round-trip safely without the browser ever holding the
 * real value.
 */
@Injectable()
export class SettingsAdminService {
  private readonly secretKeys = new Set<string>(SECRET_SETTING_KEYS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Every scope at once — the settings screen loads in one request. */
  async all(): Promise<SettingsScopeDto[]> {
    const rows = await this.prisma.setting.findMany();
    return SETTING_SCOPES.map((scope) => this.shape(scope, rows));
  }

  async scope(scope: string): Promise<SettingsScopeDto> {
    this.assertScope(scope);
    const rows = await this.prisma.setting.findMany();
    return this.shape(scope, rows);
  }

  /**
   * Validates the incoming keys against the scope schema, then writes them.
   *
   * Unknown keys are rejected rather than ignored: an operator who mistypes a key in a
   * script should hear about it, and silently accepting one would let a setting exist
   * that nothing ever reads.
   */
  async update(scope: string, payload: Record<string, unknown>): Promise<SettingsScopeDto> {
    this.assertScope(scope);

    const schema = settingScopeSchemas[scope].partial();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // 422, like every other rejected payload. This scope is validated here rather
      // than by the pipe — the schema depends on the scope in the path — and returning
      // 400 for the same error code made one route disagree with the documented
      // contract and with the client's error handling.
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Some fields need attention',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const known = new Set(Object.keys(settingScopeSchemas[scope].shape));
    const unknown = Object.keys(payload).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: SYSTEM_ERRORS.SETTING_SCOPE_UNKNOWN,
        message: `These keys do not belong to the "${scope}" scope`,
        details: { unknown, allowed: [...known] },
      });
    }

    const credentialsKey = this.config.get<string>('CREDENTIALS_KEY') ?? '';

    for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
      if (this.secretKeys.has(key)) {
        // An untouched secret comes back as the mask; writing it would destroy the
        // stored value and leave the integration silently broken.
        if (value === SECRET_MASK) continue;
        const stored =
          typeof value === 'string' && value.length > 0
            ? encryptSecret(value, credentialsKey)
            : '';
        await this.write(key, scope, stored, true);
        continue;
      }
      await this.write(key, scope, value, false);
    }

    this.settings.invalidate();
    return this.scope(scope);
  }

  /**
   * The decrypted value of one secret, for the services that actually call the third
   * party. Never reachable from a controller.
   */
  async secret(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key }, select: { value: true } });
    const stored = row?.value;
    if (!isEncrypted(stored)) return typeof stored === 'string' && stored ? stored : null;
    try {
      return decryptSecret(stored, this.config.get<string>('CREDENTIALS_KEY') ?? '');
    } catch {
      // A key rotation without a re-encrypt leaves rows nothing can read. Returning
      // null makes the integration report "not configured" rather than crash a request.
      return null;
    }
  }

  private async write(
    key: string,
    scope: string,
    value: unknown,
    secret: boolean,
  ): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, scope, value: value as Prisma.InputJsonValue, secret },
      update: { value: value as Prisma.InputJsonValue, scope, secret },
    });
  }

  private shape(
    scope: SettingScope,
    rows: Array<{ key: string; value: unknown; updatedAt: Date }>,
  ): SettingsScopeDto {
    const keys = Object.keys(settingScopeSchemas[scope].shape);
    const byKey = new Map(rows.map((row) => [row.key, row]));

    const values: Record<string, unknown> = {};
    let updatedAt: Date | null = null;

    for (const key of keys) {
      const row = byKey.get(key);
      if (!row) continue;
      values[key] = this.secretKeys.has(key)
        ? row.value
          ? SECRET_MASK
          : ''
        : row.value;
      if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
    }

    return { scope, values, updatedAt: updatedAt?.toISOString() ?? null };
  }

  private assertScope(scope: string): asserts scope is SettingScope {
    if (!(SETTING_SCOPES as readonly string[]).includes(scope)) {
      throw new BadRequestException({
        code: SYSTEM_ERRORS.SETTING_SCOPE_UNKNOWN,
        message: `Unknown settings scope "${scope}"`,
        details: { allowed: SETTING_SCOPES },
      });
    }
  }
}
