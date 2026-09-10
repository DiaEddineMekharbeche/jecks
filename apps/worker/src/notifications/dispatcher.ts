import type { PrismaClient } from '@jecks/db';
import {
  LogNotifier,
  HttpSmsNotifier,
  SmtpNotifier,
  TelegramNotifier,
  TwilioSmsNotifier,
  WhatsAppCloudNotifier,
} from './adapters.js';
import type { Channel, Notifier, OutgoingMessage } from './notifier.js';

/**
 * Notification dispatch — PRD Section 6.1.
 *
 * One job type carries every event. It resolves the recipient, renders the template in
 * the customer's own language, picks the transport the shop configured, and records
 * what happened.
 *
 * Two properties matter more than anything else here:
 *
 * - **It never sends twice.** Every message has a dedupe key, and the `Notification`
 *   table has a unique index on it. A queue retry after a partial failure is safe,
 *   which is what makes retrying safe to enable at all.
 * - **It never fails an order.** A notification is a consequence of a business event,
 *   not part of it. Everything here is caught and recorded.
 */

export interface DispatchJob {
  event: string;
  orderId?: string;
  customerId?: string;
  productId?: string;
  variantId?: string;
  /** Overrides the resolved recipient — used by the "test send" button. */
  recipient?: string;
  locale?: string;
  /** Extra template variables the caller already knows. */
  variables?: Record<string, string>;
  test?: boolean;
}

export interface DispatchDeps {
  prisma: PrismaClient;
  /** Reads a decrypted credential from settings. */
  secret: (key: string) => Promise<string | null>;
  storefrontUrl: string;
  log?: (line: string) => void;
}

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
  reason?: string;
}

/** Events the shop sends to the owner rather than to a customer. */
const OWNER_EVENTS = new Set(['owner.new_order', 'inventory.low', 'delivery.failed']);

export async function dispatchNotification(
  job: DispatchJob,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const settings = await readSettings(deps.prisma);
  const locale = job.locale ?? 'fr';

  const context = await buildContext(job, deps);
  if (!context) return { sent: 0, skipped: 1, failed: 0, reason: 'nothing to notify about' };

  const channel = await pickChannel(deps.prisma, job.event, settings, OWNER_EVENTS.has(job.event));
  if (!channel) return { sent: 0, skipped: 1, failed: 0, reason: 'no active template' };

  const recipient = job.recipient ?? recipientFor(channel, context, settings);
  if (!recipient) return { sent: 0, skipped: 1, failed: 0, reason: 'no recipient' };

  const template = await deps.prisma.notificationTemplate.findUnique({
    where: { event_channel: { event: job.event, channel } },
  });
  if (!template || !template.active) {
    return { sent: 0, skipped: 1, failed: 0, reason: 'no active template' };
  }

  const variables = { ...context.variables, ...(job.variables ?? {}) };
  const body = render(pick(template.body as Record<string, string>, context.locale ?? locale), variables);
  const subject = template.subject
    ? render(pick(template.subject as Record<string, string>, context.locale ?? locale), variables)
    : null;

  // A stable key across retries: same event, same recipient, same order.
  const dedupeKey = job.test
    ? null
    : `${job.event}:${channel}:${recipient}:${job.orderId ?? job.customerId ?? job.variantId ?? 'none'}`;

  if (dedupeKey) {
    const already = await deps.prisma.notification.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });
    // Already sent means done. Already failed means this is a retry, and it proceeds.
    if (already?.status === 'sent') {
      return { sent: 0, skipped: 1, failed: 0, reason: 'already sent' };
    }
  }

  const notifier = await resolveNotifier(channel, settings, deps);
  const message: OutgoingMessage = {
    channel,
    recipient,
    subject,
    body,
    locale: context.locale ?? locale,
    event: job.event,
  };

  const record = await upsertNotification(deps.prisma, {
    dedupeKey,
    channel,
    event: job.event,
    recipient,
    subject,
    body,
    locale: message.locale,
    userId: context.userId,
    metadata: { orderId: job.orderId ?? null, test: job.test ?? false },
  });

  // In-app notifications have no transport: the row *is* the delivery.
  if (channel === 'IN_APP') {
    await deps.prisma.notification.update({
      where: { id: record.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return { sent: 1, skipped: 0, failed: 0 };
  }

  try {
    const result = await notifier.send(message);
    await deps.prisma.notification.update({
      where: { id: record.id },
      data: {
        status: result.delivered ? 'sent' : 'failed',
        sentAt: result.delivered ? new Date() : null,
        error: result.error?.slice(0, 500) ?? null,
        attempts: { increment: 1 },
        metadata: { reference: result.reference, adapter: notifier.key },
      },
    });

    return result.delivered
      ? { sent: 1, skipped: 0, failed: 0 }
      : { sent: 0, skipped: 0, failed: 1, reason: result.error };
  } catch (error) {
    await deps.prisma.notification.update({
      where: { id: record.id },
      data: {
        status: 'failed',
        error: String(error).slice(0, 500),
        attempts: { increment: 1 },
      },
    });
    return { sent: 0, skipped: 0, failed: 1, reason: String(error) };
  }
}

// --- context ----------------------------------------------------------------

interface Context {
  variables: Record<string, string>;
  phone: string | null;
  email: string | null;
  locale: string | null;
  userId: string | null;
}

/**
 * Gathers what the template can refer to.
 *
 * The order is read once and everything derives from it, so a template that mentions
 * the courier and one that mentions the total cost the same single query.
 */
async function buildContext(job: DispatchJob, deps: DispatchDeps): Promise<Context | null> {
  const storeName = 'Jeck’s';

  if (job.orderId) {
    const order = await deps.prisma.order.findUnique({
      where: { id: job.orderId },
      include: {
        customer: { select: { locale: true, userId: true } },
        shipments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { trackingNumber: true, courier: { select: { name: true } } },
        },
        items: { take: 1, select: { productName: true } },
      },
    });
    if (!order) return null;

    const shipment = order.shipments[0];
    return {
      phone: order.customerPhone,
      email: order.customerEmail,
      locale: order.customer?.locale ?? null,
      userId: order.customer?.userId ?? null,
      variables: {
        storeName,
        customerName: order.customerName.split(' ')[0] ?? order.customerName,
        orderNumber: order.number,
        total: formatDa(order.total),
        trackingUrl: `${deps.storefrontUrl}/fr/track?number=${order.number}`,
        courier: shipment?.courier?.name ?? '',
        trackingNumber: shipment?.trackingNumber ?? '',
        wilaya: order.wilayaName,
        customerPhone: order.customerPhone,
        productName: nameOf(order.items[0]?.productName),
        reviewUrl: `${deps.storefrontUrl}/fr/account/orders/${order.number}`,
      },
    };
  }

  if (job.variantId || job.productId) {
    const variant = job.variantId
      ? await deps.prisma.variant.findUnique({
          where: { id: job.variantId },
          select: {
            sku: true,
            product: { select: { name: true, slug: true } },
            inventoryLevels: { select: { onHand: true, reserved: true } },
          },
        })
      : null;

    const product = variant?.product
      ? variant.product
      : job.productId
        ? await deps.prisma.product.findUnique({
            where: { id: job.productId },
            select: { name: true, slug: true },
          })
        : null;

    if (!product) return null;

    const available = (variant?.inventoryLevels ?? []).reduce(
      (sum, level) => sum + Math.max(level.onHand - level.reserved, 0),
      0,
    );

    return {
      phone: null,
      email: null,
      locale: null,
      userId: null,
      variables: {
        storeName,
        productName: nameOf(product.name),
        productUrl: `${deps.storefrontUrl}/fr/products/${product.slug}`,
        sku: variant?.sku ?? '',
        available: String(available),
        locationName: '',
      },
    };
  }

  if (job.customerId) {
    const customer = await deps.prisma.customer.findUnique({
      where: { id: job.customerId },
      select: { fullName: true, phone: true, email: true, locale: true, userId: true },
    });
    if (!customer) return null;

    return {
      phone: customer.phone,
      email: customer.email,
      locale: customer.locale,
      userId: customer.userId,
      variables: {
        storeName,
        customerName: customer.fullName.split(' ')[0] ?? customer.fullName,
      },
    };
  }

  // A test send carries its own recipient and needs no subject at all.
  return { variables: { storeName }, phone: null, email: null, locale: null, userId: null };
}

function recipientFor(
  channel: Channel,
  context: Context,
  settings: Record<string, unknown>,
): string | null {
  if (channel === 'EMAIL') return context.email;
  if (channel === 'TELEGRAM') return String(settings['notifications.telegram_chat_id'] ?? '') || 'owner';
  if (channel === 'IN_APP') return context.userId ?? 'admin';
  return context.phone;
}

/**
 * Which channel carries an event.
 *
 * The active template decides. SMS first for customers, because that is what an
 * Algerian shopper reads; Telegram first for owner alerts, because it is free.
 */
async function pickChannel(
  prisma: PrismaClient,
  event: string,
  settings: Record<string, unknown>,
  ownerAlert: boolean,
): Promise<Channel | null> {
  const preference: Channel[] = ownerAlert
    ? ['TELEGRAM', 'IN_APP', 'EMAIL', 'SMS']
    : ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'];

  const templates = await prisma.notificationTemplate.findMany({
    where: { event, active: true },
    select: { channel: true },
  });
  const available = new Set(templates.map((template) => template.channel as Channel));

  if (ownerAlert && settings['notifications.telegram_enabled'] !== true) {
    available.delete('TELEGRAM');
  }

  return preference.find((channel) => available.has(channel)) ?? null;
}

// --- transports -------------------------------------------------------------

async function resolveNotifier(
  channel: Channel,
  settings: Record<string, unknown>,
  deps: DispatchDeps,
): Promise<Notifier> {
  const fallback = new LogNotifier((line) => deps.log?.(line));

  if (channel === 'EMAIL') {
    if (settings['notifications.email_driver'] !== 'smtp') return fallback;
    const smtp = new SmtpNotifier({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      from: process.env.MAIL_FROM ?? "Jeck's <no-reply@jecks.dz>",
    });
    return smtp.isConfigured() ? smtp : fallback;
  }

  if (channel === 'TELEGRAM') {
    const token = await deps.secret('notifications.telegram_token');
    const chatId = String(settings['notifications.telegram_chat_id'] ?? '');
    const telegram = new TelegramNotifier({ token: token ?? '', chatId });
    return telegram.isConfigured() ? telegram : fallback;
  }

  if (channel === 'WHATSAPP' || channel === 'SMS') {
    const driver = String(settings['notifications.sms_driver'] ?? 'log');
    const credentials = parseCredentials(await deps.secret('notifications.sms_credentials'));

    if (driver === 'twilio') {
      const twilio = new TwilioSmsNotifier({
        accountSid: credentials.accountSid ?? '',
        authToken: credentials.authToken ?? '',
        from: credentials.from ?? '',
      });
      return twilio.isConfigured() ? twilio : fallback;
    }

    if (driver === 'whatsapp') {
      const whatsapp = new WhatsAppCloudNotifier({
        phoneNumberId: credentials.phoneNumberId ?? '',
        accessToken: credentials.accessToken ?? '',
      });
      return whatsapp.isConfigured() ? whatsapp : fallback;
    }

    if (driver === 'http') {
      const http = new HttpSmsNotifier({
        endpoint: String(settings['notifications.sms_endpoint'] ?? ''),
        bodyTemplate: credentials.bodyTemplate,
        headers: credentials.headers as Record<string, string> | undefined,
        method: credentials.method as 'GET' | 'POST' | undefined,
      });
      return http.isConfigured() ? http : fallback;
    }
  }

  return fallback;
}

/** Gateway credentials are one encrypted JSON blob, so a new gateway needs no column. */
function parseCredentials(raw: string | null): Record<string, string | undefined> & {
  headers?: unknown;
} {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

// --- persistence ------------------------------------------------------------

async function upsertNotification(
  prisma: PrismaClient,
  input: {
    dedupeKey: string | null;
    channel: Channel;
    event: string;
    recipient: string;
    subject: string | null;
    body: string;
    locale: string;
    userId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const data = {
    userId: input.userId,
    channel: input.channel,
    event: input.event,
    title: input.subject ?? input.event,
    body: input.body,
    recipient: input.recipient,
    locale: input.locale,
    status: 'queued',
    metadata: input.metadata as never,
  };

  if (!input.dedupeKey) return prisma.notification.create({ data });

  // Upsert on the dedupe key: a retry updates the existing row rather than creating a
  // second one and failing on the unique index.
  return prisma.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...data, dedupeKey: input.dedupeKey },
    update: { status: 'queued', error: null },
  });
}

async function readSettings(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany({ where: { scope: 'notifications' } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

// --- rendering --------------------------------------------------------------

/**
 * The same substitution the API's preview uses — `{{name}}` and nothing else.
 *
 * Duplicated deliberately: the worker must not depend on the API package, and a
 * template language shared across a process boundary is a coupling worth avoiding for
 * fifteen lines.
 */
export function render(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : value;
  });
}

function pick(field: Record<string, string> | null | undefined, locale: string): string {
  if (!field) return '';
  return field[locale] ?? field.fr ?? Object.values(field)[0] ?? '';
}

function nameOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const translated = value as Record<string, string>;
  return translated.fr ?? Object.values(translated)[0] ?? '';
}

function formatDa(minor: bigint): string {
  const value = Number(minor) / 100;
  return `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(value)} DA`;
}
