import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type NotificationChannel } from '@jecks/db';
import type {
  NotificationTemplateDto,
  NotificationTemplateInput,
  TemplateTestInput,
  Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Notification templates — PRD Section 6.1, edited from Settings › Notifications.
 *
 * Rendering lives here rather than in the worker because the preview and the real send
 * must produce identical text. A preview that renders differently is worse than none:
 * it tells the owner the message is fine when it is not.
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
  ) {}

  async list(): Promise<NotificationTemplateDto[]> {
    const rows = await this.prisma.notificationTemplate.findMany({
      orderBy: [{ event: 'asc' }, { channel: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<NotificationTemplateDto> {
    const row = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Template not found' });
    return toDto(row);
  }

  /**
   * Upsert on (event, channel): the editor is a grid of events by channels, and saving
   * a cell that has never been filled in must create it rather than 404.
   */
  async save(input: NotificationTemplateInput): Promise<NotificationTemplateDto> {
    const row = await this.prisma.notificationTemplate.upsert({
      where: { event_channel: { event: input.event, channel: input.channel as NotificationChannel } },
      create: {
        event: input.event,
        channel: input.channel as NotificationChannel,
        subject: (input.subject ?? undefined) as Prisma.InputJsonValue | undefined,
        body: input.body as Prisma.InputJsonValue,
        active: input.active,
      },
      update: {
        subject: (input.subject ?? Prisma.DbNull) as Prisma.InputJsonValue,
        body: input.body as Prisma.InputJsonValue,
        active: input.active,
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.notificationTemplate.delete({ where: { id } });
  }

  /** Renders the template with sample values, without sending anything. */
  async preview(
    id: string,
    locale: 'fr' | 'ar' | 'en' = 'fr',
  ): Promise<{ subject: string | null; body: string }> {
    const template = await this.get(id);
    const variables = await this.sampleVariables(template.event);
    return {
      subject: template.subject ? renderTemplate(pick(template.subject, locale), variables) : null,
      body: renderTemplate(pick(template.body, locale), variables),
    };
  }

  /**
   * Queues one real send to an address the owner types, so "does my SMS gateway work"
   * has an answer that does not involve placing a test order.
   */
  async test(id: string, input: TemplateTestInput): Promise<{ queued: boolean }> {
    const template = await this.get(id);
    const rendered = await this.preview(id, input.locale);

    const queued = await this.queue.enqueue('notifications', 'notification.send', {
      channel: template.channel,
      event: `${template.event}.test`,
      recipient: input.recipient,
      subject: rendered.subject,
      body: rendered.body,
      locale: input.locale,
      test: true,
    });

    return { queued: queued !== null };
  }

  /** Believable values so a preview reads like a real message, not like `{{total}}`. */
  private async sampleVariables(event: string): Promise<Record<string, string>> {
    const storeName = await this.settings.get<string>('store.name', "Jeck's");
    const storePhone = (await this.settings.get<string[]>('store.phones', []))[0] ?? '';

    return {
      storeName,
      storePhone,
      customerName: 'Yacine Benali',
      orderNumber: 'JK-260910-0042',
      total: '4 900,00 DA',
      trackingUrl: 'https://jecks.dz/track/JK-260910-0042',
      cartUrl: 'https://jecks.dz/panier',
      reviewUrl: 'https://jecks.dz/avis/JK-260910-0042',
      productUrl: 'https://jecks.dz/produits/casquette-atlas',
      productName: 'Casquette Atlas',
      sku: 'ATL-NOI-M',
      available: '2',
      locationName: 'Entrepôt Alger',
      courier: 'Yalidine',
      trackingNumber: 'YAL-88213004',
      driverName: 'Karim',
      driverPhone: '0550 11 22 33',
      wilaya: 'Alger',
      customerPhone: '+213551234567',
      reason: event.includes('failed') ? 'Client injoignable' : 'Annulée par le client',
      promoCode: 'RETOUR10',
      code: '482913',
      minutes: '10',
    };
  }
}

/**
 * Handlebars-shaped substitution: `{{name}}`, nothing else.
 *
 * No conditionals, no loops, no helpers. A notification template is one paragraph an
 * owner edits in a textarea; a template language would be a code path taking input from
 * the database and evaluating it.
 */
export function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    // An unknown variable is left visible rather than blanked: a message that reads
    // "Bonjour {{firstName}}" tells the owner exactly what to fix, an empty gap does not.
    return value === undefined ? match : value;
  });
}

function pick(field: Translated, locale: 'fr' | 'ar' | 'en'): string {
  return field[locale] ?? field.fr ?? Object.values(field)[0] ?? '';
}

function toDto(row: {
  id: string;
  event: string;
  channel: NotificationChannel;
  subject: unknown;
  body: unknown;
  active: boolean;
  updatedAt: Date;
}): NotificationTemplateDto {
  return {
    id: row.id,
    event: row.event,
    channel: row.channel,
    subject: (row.subject ?? null) as Translated | null,
    body: (row.body ?? {}) as Translated,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}
