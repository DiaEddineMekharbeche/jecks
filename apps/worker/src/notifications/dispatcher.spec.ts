import type { PrismaClient } from '@jecks/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchNotification, type DispatchDeps } from './dispatcher.js';
import { startFakeSmtp, type FakeSmtp } from './fake-smtp.test-helper.js';

/**
 * A new order reaches the owner's inbox — over a real socket to a fake mail server, with
 * only the database stubbed. Mocking the transport would test that the code calls the
 * code; the point is that a message arrives.
 */

const ORDER = {
  id: 'order-1',
  number: 'JK-261008-0001',
  customerName: 'Amel Zidane',
  customerPhone: '+213550112233',
  customerEmail: 'amel.customer@example.com',
  wilayaName: 'Alger',
  communeName: 'Bab Ezzouar',
  deliveryType: 'HOME',
  address: 'Cité 1000 logements, bâtiment B, étage 3',
  note: 'Appeler avant de passer',
  total: 450_000n,
  shippingTotal: 30_000n,
  customer: { locale: 'fr', userId: null },
  shipments: [],
  items: [
    {
      productName: { fr: 'Casquette Marina' },
      variantName: 'Noir / M',
      quantity: 2,
      lineTotal: 420_000n,
    },
  ],
};

interface World {
  settings: Record<string, unknown>;
  templates: Array<{
    event: string;
    channel: string;
    active: boolean;
    subject: unknown;
    body: unknown;
  }>;
  notifications: Map<string, Record<string, unknown>>;
}

function makePrisma(world: World): PrismaClient {
  let counter = 0;
  return {
    setting: {
      findMany: vi.fn(async () =>
        Object.entries(world.settings).map(([key, value]) => ({
          key,
          value,
          scope: 'notifications',
        })),
      ),
    },
    order: { findUnique: vi.fn(async () => ORDER) },
    notificationTemplate: {
      findMany: vi.fn(async ({ where }: { where: { event: string } }) =>
        world.templates.filter((t) => t.event === where.event && t.active),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { event_channel: { event: string; channel: string } } }) =>
          world.templates.find(
            (t) =>
              t.event === where.event_channel.event && t.channel === where.event_channel.channel,
          ) ?? null,
      ),
    },
    notification: {
      findUnique: vi.fn(
        async ({ where }: { where: { dedupeKey: string } }) =>
          world.notifications.get(where.dedupeKey) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { dedupeKey: string };
          create: Record<string, unknown>;
        }) => {
          const row = { id: `n${++counter}`, ...create };
          world.notifications.set(where.dedupeKey, row);
          return row;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `n${++counter}`,
        ...data,
      })),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const row of world.notifications.values())
            if (row.id === where.id) Object.assign(row, data);
          return {};
        },
      ),
    },
  } as unknown as PrismaClient;
}

/** The subject travels RFC 2047 encoded; the owner's mail client shows it decoded. */
function decodeSubject(header: string | undefined): string {
  const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(header ?? '');
  return match ? Buffer.from(match[1]!, 'base64').toString('utf8') : (header ?? '');
}

const deps = (prisma: PrismaClient): DispatchDeps => ({
  prisma,
  secret: async () => null,
  storefrontUrl: 'https://shop.example',
});

let smtp: FakeSmtp | null = null;
const originalEnv = { ...process.env };

beforeEach(async () => {
  smtp = await startFakeSmtp();
  process.env.SMTP_HOST = smtp.host;
  process.env.SMTP_PORT = String(smtp.port);
  process.env.MAIL_FROM = "Jeck's <shop@example.com>";
  process.env.ADMIN_URL = 'https://admin.example';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_SECURE;
});

afterEach(async () => {
  await smtp?.close();
  smtp = null;
  process.env = { ...originalEnv };
});

const inApp = {
  event: 'owner.new_order',
  channel: 'IN_APP',
  active: true,
  subject: { fr: 'Nouvelle commande' },
  body: { fr: '{{orderNumber}}' },
};

function world(settings: Record<string, unknown>, templates = [inApp]): World {
  return { settings, templates, notifications: new Map() };
}

describe('the owner is e-mailed a new order', () => {
  it('sends the order to the owner address, with what is needed to act on it', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    const result = await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(result.failed).toBe(0);
    expect(smtp!.messages).toHaveLength(1);

    const mail = smtp!.messages[0]!;
    expect(mail.to).toEqual(['owner@shop.test']);
    // Intl groups thousands with a narrow no-break space, which is what a reader sees.
    expect(decodeSubject(mail.headers.subject)).toBe('Nouvelle commande JK-261008-0001 — 4 500 DA');
    expect(mail.body).toContain('JK-261008-0001');
    expect(mail.body).toContain('Amel Zidane');
    expect(mail.body).toContain('+213550112233');
    expect(mail.body).toContain('Alger');
    expect(mail.body).toContain('Bab Ezzouar');
    expect(mail.body).toContain('Cité 1000 logements, bâtiment B, étage 3');
    expect(mail.body).toContain('2 × Casquette Marina (Noir / M)');
    expect(mail.body).toContain('Appeler avant de passer');
    expect(mail.body).toContain('https://admin.example/orders/order-1');
  });

  it('sends it designed as well as in plain text, with what the customer typed made safe', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    const mail = smtp!.messages[0]!;
    expect(mail.html).toContain('JK-261008-0001');
    expect(mail.html).toContain('Amel Zidane');
    expect(mail.html).toContain('href="tel:+213550112233"');
    expect(mail.html).toContain('https://admin.example/orders/order-1');
    // The same facts are in the plain text, for a client that shows only that.
    expect(mail.body).toContain('Amel Zidane');
  });

  it('writes the customer-visible total in dinars, not centimes', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages[0]!.body).toMatch(/4\s?500(,00)?\s?DA/);
    expect(smtp!.messages[0]!.body).not.toContain('450000');
  });

  it('still records the in-app alert, because the two channels are independent', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    const channels = [...w.notifications.values()].map((row) => row.channel).sort();
    expect(channels).toEqual(['EMAIL', 'IN_APP']);
  });

  it('never sends it to the customer whose address is on the order', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages.flatMap((mail) => mail.to)).not.toContain('amel.customer@example.com');
  });

  it('sends without the driver switch when real mail credentials are configured', async () => {
    process.env.SMTP_USER = 'shop';
    const w = world({ 'notifications.owner_email': 'owner@shop.test' }); // driver left on its default
    const plain = await startFakeSmtp({ auth: ['PLAIN'], user: 'shop', password: 's3cret' });
    process.env.SMTP_PORT = String(plain.port);
    process.env.SMTP_PASSWORD = 's3cret';

    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );
    await plain.close();

    expect(plain.messages).toHaveLength(1);
    expect(plain.messages[0]!.to).toEqual(['owner@shop.test']);
  });

  it('only logs, and does not pretend to send, when there are no mail credentials', async () => {
    const w = world({ 'notifications.owner_email': 'owner@shop.test' });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages).toHaveLength(0);
  });

  it('sends nothing by e-mail when no owner address is set', async () => {
    const w = world({ 'notifications.email_driver': 'smtp' });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages).toHaveLength(0);
  });

  it('ignores a value that is not an address', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'not-an-email',
    });
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages).toHaveLength(0);
  });

  it('does not send twice when the job is retried', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    const prisma = makePrisma(w);

    await dispatchNotification({ event: 'owner.new_order', orderId: 'order-1' }, deps(prisma));
    await dispatchNotification({ event: 'owner.new_order', orderId: 'order-1' }, deps(prisma));

    expect(smtp!.messages).toHaveLength(1);
  });

  it('does not lose the order if the mail server is down, and says so', async () => {
    const w = world({
      'notifications.email_driver': 'smtp',
      'notifications.owner_email': 'owner@shop.test',
    });
    await smtp!.close();
    process.env.SMTP_PORT = '1'; // nothing listens here

    const result = await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(result.failed).toBe(1);
    const email = [...w.notifications.values()].find((row) => row.channel === 'EMAIL');
    expect(email?.status).toBe('failed');
    // The in-app alert is unaffected.
    expect([...w.notifications.values()].find((row) => row.channel === 'IN_APP')?.status).toBe(
      'sent',
    );
    smtp = null;
  });

  it('respects a template the owner switched off', async () => {
    const off = {
      event: 'owner.new_order',
      channel: 'EMAIL',
      active: false,
      subject: { fr: 'x' },
      body: { fr: 'x' },
    };
    const w = world(
      { 'notifications.email_driver': 'smtp', 'notifications.owner_email': 'owner@shop.test' },
      [inApp, off],
    );
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages).toHaveLength(0);
  });

  it('uses the edited template when the owner has customised it', async () => {
    const custom = {
      event: 'owner.new_order',
      channel: 'EMAIL',
      active: true,
      subject: { fr: 'Commande {{orderNumber}}' },
      body: { fr: 'Appelez {{customerFullName}} au {{customerPhone}}' },
    };
    const w = world(
      { 'notifications.email_driver': 'smtp', 'notifications.owner_email': 'owner@shop.test' },
      [inApp, custom],
    );
    await dispatchNotification(
      { event: 'owner.new_order', orderId: 'order-1' },
      deps(makePrisma(w)),
    );

    expect(smtp!.messages[0]!.body).toBe('Appelez Amel Zidane au +213550112233');
  });
});

describe('customer e-mails are unchanged', () => {
  it('sends an order confirmation to the customer, not the owner', async () => {
    const customerMail = {
      event: 'order.placed',
      channel: 'EMAIL',
      active: true,
      subject: { fr: 'Commande {{orderNumber}}' },
      body: { fr: 'Merci {{customerName}}' },
    };
    const w = world(
      { 'notifications.email_driver': 'smtp', 'notifications.owner_email': 'owner@shop.test' },
      [customerMail],
    );
    await dispatchNotification({ event: 'order.placed', orderId: 'order-1' }, deps(makePrisma(w)));

    expect(smtp!.messages).toHaveLength(1);
    expect(smtp!.messages[0]!.to).toEqual(['amel.customer@example.com']);
  });
});
