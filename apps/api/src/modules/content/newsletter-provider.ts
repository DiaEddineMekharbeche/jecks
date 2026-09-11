import { Injectable, Logger, Optional } from '@nestjs/common';

/**
 * Newsletter providers — PRD F-AD-91.
 *
 * The shop owns its subscriber list; a provider is somewhere to copy it so campaigns can
 * be sent. That direction matters: unsubscribing happens here and is pushed out, never
 * the other way round, so a provider that goes away cannot take the list with it.
 *
 * `log` is the default and a real implementation: it writes what it would have synced,
 * which is exactly what a shop that mails by hand needs.
 */

export interface NewsletterContact {
  email: string | null;
  phone: string | null;
  locale: string;
  source: string | null;
  unsubscribed: boolean;
}

export interface SyncResult {
  provider: string;
  sent: number;
  skipped: number;
  /** Set when the provider refused some contacts but not the batch. */
  warnings: string[];
}

export interface NewsletterProvider {
  readonly key: string;
  readonly label: string;
  /** Credential keys this provider needs before it can be used. */
  readonly requiredCredentials: readonly string[];

  sync(contacts: NewsletterContact[], credentials: Record<string, string>): Promise<SyncResult>;
}

export type NewsletterHttpClient = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class NewsletterConfigurationError extends Error {
  readonly code = 'NEWSLETTER_NOT_READY';
  constructor(provider: string, missing: string[]) {
    super(`The ${provider} newsletter provider is missing: ${missing.join(', ')}`);
    this.name = 'NewsletterConfigurationError';
  }
}

/**
 * The default: writes what it would have sent.
 *
 * A shop with no campaign tool still has a list worth keeping, and this makes the sync
 * button do something honest rather than being greyed out.
 */
@Injectable()
export class LogNewsletterProvider implements NewsletterProvider {
  readonly key = 'log';
  readonly label = 'Journal (aucun envoi)';
  readonly requiredCredentials = [] as const;

  private readonly logger = new Logger(LogNewsletterProvider.name);

  async sync(contacts: NewsletterContact[]): Promise<SyncResult> {
    const active = contacts.filter((contact) => !contact.unsubscribed);

    this.logger.log(
      `Would sync ${active.length} contact(s); ${contacts.length - active.length} unsubscribed`,
    );

    return { provider: this.key, sent: active.length, skipped: contacts.length - active.length, warnings: [] };
  }
}

interface BrevoError {
  message?: string;
  code?: string;
}

/**
 * Brevo, formerly Sendinblue — the campaign tool most Algerian shops end up on.
 *
 * Two of its habits shape this adapter. Contacts are upserted in batches of a hundred
 * through one endpoint, and an unsubscribe is expressed by setting `emailBlacklisted`
 * rather than by deleting the contact: deleting would let the same address be re-added
 * by the next sync and mailed again after asking not to be.
 */
@Injectable()
export class BrevoNewsletterProvider implements NewsletterProvider {
  readonly key = 'brevo';
  readonly label = 'Brevo';
  readonly requiredCredentials = ['apiKey', 'listId'] as const;

  private readonly logger = new Logger(BrevoNewsletterProvider.name);

  constructor(@Optional() private readonly http: NewsletterHttpClient = (url, init) => fetch(url, init)) {}

  async sync(
    contacts: NewsletterContact[],
    credentials: Record<string, string>,
  ): Promise<SyncResult> {
    const missing = this.requiredCredentials.filter((key) => !credentials[key]?.trim());
    if (missing.length > 0) throw new NewsletterConfigurationError(this.label, [...missing]);

    // Brevo keys contacts by e-mail; a phone-only subscriber has nowhere to go there and
    // is counted as skipped rather than silently dropped.
    const withEmail = contacts.filter((contact) => Boolean(contact.email));
    const skipped = contacts.length - withEmail.length;

    const listId = Number(credentials.listId);
    const warnings: string[] = [];
    let sent = 0;

    for (const batch of chunk(withEmail, 100)) {
      const body = {
        listIds: [listId],
        updateExistingContacts: true,
        emptyContactsAttributes: false,
        jsonBody: batch.map((contact) => ({
          email: contact.email,
          attributes: {
            SMS: contact.phone ?? undefined,
            LANGUAGE: contact.locale.toUpperCase(),
            SOURCE: contact.source ?? 'jecks',
          },
          emailBlacklisted: contact.unsubscribed,
        })),
      };

      const response = await this.http('https://api.brevo.com/v3/contacts/import', {
        method: 'POST',
        headers: {
          'api-key': credentials.apiKey!,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      if (!response.ok) {
        const detail = parseError(text);
        // One rejected batch must not lose the ones that went through.
        warnings.push(`${batch.length} contact(s) refusés : ${detail}`);
        this.logger.warn(`Brevo refused a batch (${response.status}): ${detail}`);
        continue;
      }

      sent += batch.length;
    }

    return { provider: this.key, sent, skipped, warnings };
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/** Brevo's own message when it has one, the raw body when it does not. */
export function parseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as BrevoError;
    return parsed.message ?? parsed.code ?? body.slice(0, 120);
  } catch {
    return body.slice(0, 120) || 'no detail';
  }
}
