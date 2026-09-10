import { SECRET_MASK } from '@jecks/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { decryptSecret, encryptSecret } from '../../common/crypto/secrets.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CourierConfigurationError } from './courier-provider.js';
import { CourierRegistry } from './courier-registry.service.js';
import { EmsCourier } from './ems.courier.js';
import { ManualCourier } from './manual.courier.js';
import { MaystroCourier } from './maystro.courier.js';
import { YalidineCourier } from './yalidine.courier.js';
import { ZrExpressCourier } from './zrexpress.courier.js';

/**
 * The registry against an in-memory credential table.
 *
 * What is worth testing here is not the plumbing but the two rules that protect a
 * working integration: a masked value must never overwrite a real secret, and an adapter
 * must refuse to act before it has what it needs.
 */

const KEY = 'test-credentials-key';

interface Row {
  courierId: string;
  key: string;
  valueEnc: string;
}

function makeRegistry(rows: Row[] = []) {
  const store = [...rows];

  const prisma = {
    courierCredential: {
      findMany: vi.fn(async ({ where }: { where: { courierId: string } }) =>
        store.filter((row) => row.courierId === where.courierId),
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { courierId_key: { courierId: string; key: string } };
          create: Row;
          update: { valueEnc: string };
        }) => {
          const existing = store.find(
            (row) =>
              row.courierId === where.courierId_key.courierId && row.key === where.courierId_key.key,
          );
          if (existing) existing.valueEnc = update.valueEnc;
          else store.push(create);
          return create;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { courierId: string; key: string } }) => {
        const index = store.findIndex(
          (row) => row.courierId === where.courierId && row.key === where.key,
        );
        if (index >= 0) store.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      }),
    },
  } as unknown as PrismaService;

  const config = { get: vi.fn(() => KEY) } as unknown as ConfigService;

  const registry = new CourierRegistry(
    prisma,
    config,
    new ManualCourier(),
    new YalidineCourier(),
    new ZrExpressCourier(),
    new MaystroCourier(),
    new EmsCourier(),
  );

  return { registry, store };
}

describe('CourierRegistry', () => {
  let registry: CourierRegistry;
  let store: Row[];

  beforeEach(() => {
    ({ registry, store } = makeRegistry());
  });

  it('resolves each adapter by its key', () => {
    expect(registry.adapterFor('manual').key).toBe('manual');
    expect(registry.adapterFor('yalidine').key).toBe('yalidine');
    expect(registry.adapterFor('zrexpress').key).toBe('zrexpress');
    expect(registry.adapterFor('maystro').key).toBe('maystro');
    expect(registry.adapterFor('ems').key).toBe('ems');
  });

  it('falls back to manual for a provider it does not know', () => {
    // A renamed provider still has parcels in the field; refusing to look at them helps
    // nobody, so the fallback is deliberate.
    expect(registry.adapterFor('some-new-courier').key).toBe('manual');
  });

  it('lists every adapter it ships', () => {
    expect(registry.list()).toHaveLength(5);
    expect(registry.providerKeys()).toContain('yalidine');
  });

  it('encrypts what it stores', async () => {
    await registry.saveCredentials('c1', { apiToken: 'super-secret' });

    const stored = store.find((row) => row.key === 'apiToken')!;
    expect(stored.valueEnc).not.toContain('super-secret');
    expect(decryptSecret(stored.valueEnc, KEY)).toBe('super-secret');
  });

  it('gives an adapter its credentials in the clear', async () => {
    await registry.saveCredentials('c1', { apiId: '42', apiToken: 'secret' });
    expect(await registry.credentialsFor('c1')).toEqual({ apiId: '42', apiToken: 'secret' });
  });

  it('leaves a masked value alone instead of overwriting the real one', async () => {
    await registry.saveCredentials('c1', { apiToken: 'real-token' });
    await registry.saveCredentials('c1', { apiToken: SECRET_MASK });

    expect((await registry.credentialsFor('c1')).apiToken).toBe('real-token');
  });

  it('deletes a credential that is blanked', async () => {
    await registry.saveCredentials('c1', { apiToken: 'real-token' });
    await registry.saveCredentials('c1', { apiToken: '   ' });

    expect(await registry.credentialsFor('c1')).toEqual({});
  });

  it('reports which keys were written', async () => {
    const written = await registry.saveCredentials('c1', {
      apiId: '42',
      apiToken: SECRET_MASK,
    });
    expect(written).toEqual(['apiId']);
  });

  it('reads a value that predates encryption without failing', async () => {
    ({ registry } = makeRegistry([{ courierId: 'c1', key: 'apiId', valueEnc: 'plain-42' }]));
    expect((await registry.credentialsFor('c1')).apiId).toBe('plain-42');
  });

  it('describes a courier as not ready while a required key is missing', async () => {
    await registry.saveCredentials('c1', { apiId: '42' });
    expect(await registry.describe('c1', 'yalidine')).toEqual({
      configuredKeys: ['apiId'],
      ready: false,
    });
  });

  it('describes a courier as ready once every required key is set', async () => {
    await registry.saveCredentials('c1', { apiId: '42', apiToken: 'secret' });
    const described = await registry.describe('c1', 'yalidine');
    expect(described.ready).toBe(true);
  });

  it('treats an adapter that needs nothing as always ready', async () => {
    expect((await registry.describe('c1', 'manual')).ready).toBe(true);
  });

  it('refuses to act for a courier that is not configured, naming what is missing', async () => {
    await expect(registry.assertReady('c1', 'maystro')).rejects.toThrow(CourierConfigurationError);
    await expect(registry.assertReady('c1', 'maystro')).rejects.toThrow(/apiKey/);
  });

  it('hands back the credentials once they are complete', async () => {
    await registry.saveCredentials('c1', { apiKey: 'k' });
    expect(await registry.assertReady('c1', 'maystro')).toEqual({ apiKey: 'k' });
  });

  it('keeps one courier credentials away from another', async () => {
    await registry.saveCredentials('c1', { apiKey: 'first' });
    await registry.saveCredentials('c2', { apiKey: 'second' });

    expect((await registry.credentialsFor('c1')).apiKey).toBe('first');
    expect((await registry.credentialsFor('c2')).apiKey).toBe('second');
  });

  it('reads back a value encrypted elsewhere with the same key', async () => {
    ({ registry } = makeRegistry([
      { courierId: 'c1', key: 'apiToken', valueEnc: encryptSecret('from-elsewhere', KEY) },
    ]));
    expect((await registry.credentialsFor('c1')).apiToken).toBe('from-elsewhere');
  });
});
