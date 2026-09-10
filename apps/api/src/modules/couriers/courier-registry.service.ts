import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SECRET_MASK, type CourierProviderKey } from '@jecks/shared';
import { decryptSecret, encryptSecret, isEncrypted } from '../../common/crypto/secrets.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CourierConfigurationError,
  type CourierCredentials,
  type CourierProvider,
} from './courier-provider.js';
import { EmsCourier } from './ems.courier.js';
import { ManualCourier } from './manual.courier.js';
import { MaystroCourier } from './maystro.courier.js';
import { YalidineCourier } from './yalidine.courier.js';
import { ZrExpressCourier } from './zrexpress.courier.js';

/**
 * Resolves a courier row to the adapter that speaks its API, and hands that adapter its
 * decrypted credentials — PRD F-AD-61 and Section 10.8.
 *
 * Credentials never leave this service in the clear except into an adapter. The admin
 * sees which keys are set, never their values, which is why `describe` returns names and
 * a mask rather than anything that could be copied out of a screenshot.
 */
@Injectable()
export class CourierRegistry {
  private readonly logger = new Logger(CourierRegistry.name);
  private readonly adapters = new Map<string, CourierProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    manual: ManualCourier,
    yalidine: YalidineCourier,
    zrExpress: ZrExpressCourier,
    maystro: MaystroCourier,
    ems: EmsCourier,
  ) {
    for (const adapter of [manual, yalidine, zrExpress, maystro, ems]) {
      this.adapters.set(adapter.key, adapter);
    }
  }

  /**
   * The adapter for a provider key.
   *
   * An unknown key falls back to `manual` rather than throwing: a courier row whose
   * provider was renamed still has parcels in the field, and refusing to look at them
   * helps nobody. The log line is how the mistake gets noticed.
   */
  adapterFor(providerKey: string): CourierProvider {
    const adapter = this.adapters.get(providerKey);
    if (adapter) return adapter;

    this.logger.warn(`Unknown courier provider "${providerKey}"; falling back to manual`);
    return this.adapters.get('manual')!;
  }

  list(): CourierProvider[] {
    return [...this.adapters.values()];
  }

  /** Decrypted credentials for one courier, ready to hand to its adapter. */
  async credentialsFor(courierId: string): Promise<CourierCredentials> {
    const rows = await this.prisma.courierCredential.findMany({
      where: { courierId },
      select: { key: true, valueEnc: true },
    });

    const key = this.config.get<string>('CREDENTIALS_KEY') ?? '';
    const credentials: CourierCredentials = {};

    for (const row of rows) {
      credentials[row.key] = isEncrypted(row.valueEnc) ? decryptSecret(row.valueEnc, key) : row.valueEnc;
    }
    return credentials;
  }

  /**
   * Stores credentials, encrypting each value.
   *
   * A value equal to the mask means "leave this one alone": the form round-trips masked
   * values, and treating the mask as a new secret would overwrite a working API key with
   * eight bullet characters.
   */
  async saveCredentials(courierId: string, values: Record<string, string>): Promise<string[]> {
    const key = this.config.get<string>('CREDENTIALS_KEY') ?? '';
    const written: string[] = [];

    for (const [name, value] of Object.entries(values)) {
      if (value === SECRET_MASK) continue;

      if (value.trim() === '') {
        await this.prisma.courierCredential.deleteMany({ where: { courierId, key: name } });
        continue;
      }

      const valueEnc = encryptSecret(value, key);
      await this.prisma.courierCredential.upsert({
        where: { courierId_key: { courierId, key: name } },
        create: { courierId, key: name, valueEnc },
        update: { valueEnc },
      });
      written.push(name);
    }

    return written;
  }

  /** Which credential keys a courier has, and whether that is enough to trade. */
  async describe(courierId: string, providerKey: string): Promise<{ configuredKeys: string[]; ready: boolean }> {
    const rows = await this.prisma.courierCredential.findMany({
      where: { courierId },
      select: { key: true },
      orderBy: { key: 'asc' },
    });

    const configuredKeys = rows.map((row) => row.key);
    const adapter = this.adapterFor(providerKey);
    const ready = adapter.requiredCredentials.every((required) => configuredKeys.includes(required));

    return { configuredKeys, ready };
  }

  /** Throws unless the courier can actually be used, naming what is missing. */
  async assertReady(courierId: string, providerKey: string): Promise<CourierCredentials> {
    const credentials = await this.credentialsFor(courierId);
    const adapter = this.adapterFor(providerKey);
    const missing = adapter.requiredCredentials.filter((key) => !credentials[key]?.trim());

    if (missing.length > 0) throw new CourierConfigurationError(adapter.label, [...missing]);
    return credentials;
  }

  /** The provider keys the platform ships, for the Settings selector. */
  providerKeys(): CourierProviderKey[] {
    return [...this.adapters.keys()] as CourierProviderKey[];
  }
}
