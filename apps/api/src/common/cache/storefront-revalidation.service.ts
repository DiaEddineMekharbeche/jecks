import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorefrontCacheTag } from '@jecks/shared';

/**
 * Tells the storefront that something it has cached is now wrong — PRD F-AD-10.
 *
 * Clearing the API's own Redis cache is only half of it. The storefront is a separate
 * process with its own cache, holding rendered pages for two to five minutes, and
 * nothing used to tell it anything. An owner published a product, looked at the shop,
 * saw nothing, and reasonably concluded the save had failed.
 *
 * Fire and forget. A shop whose storefront is restarting must still be able to publish
 * a product; the page catches up when its own timer expires, which is the behaviour that
 * existed before this and is an acceptable floor.
 */
/**
 * Replaces `fetch` in tests. Nest resolves every constructor parameter from the container,
 * so a plain default value is not enough: without a token and `@Optional()` the API fails
 * to boot looking for a provider of `Object`.
 */
export const REVALIDATION_FETCH = Symbol('REVALIDATION_FETCH');

@Injectable()
export class StorefrontRevalidationService {
  private readonly logger = new Logger(StorefrontRevalidationService.name);
  private readonly url: string | null;
  private readonly token: string | null;
  private readonly http: typeof fetch;

  constructor(config: ConfigService, @Optional() @Inject(REVALIDATION_FETCH) http?: typeof fetch) {
    this.http = http ?? ((input, init) => fetch(input, init));
    const base =
      config.get<string>('STOREFRONT_INTERNAL_URL') ?? config.get<string>('STOREFRONT_URL');
    this.token = config.get<string>('REVALIDATE_TOKEN') ?? null;
    this.url = base ? `${base.replace(/\/$/, '')}/api/revalidate` : null;
  }

  get enabled(): boolean {
    return Boolean(this.url && this.token);
  }

  /**
   * Asks the storefront to drop the given cache tags.
   *
   * Never throws and never blocks the response: the write has already succeeded by the
   * time this runs, and failing the request because a cache could not be cleared would
   * turn a working publish into an error the owner cannot act on.
   */
  revalidate(tags: StorefrontCacheTag[]): void {
    if (!this.enabled || tags.length === 0) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    void this.http(this.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-token': this.token! },
      body: JSON.stringify({ tags }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          this.logger.warn(`The storefront refused a revalidation (${response.status})`);
        }
      })
      .catch((error: Error) => {
        // Expected while the storefront is restarting. The page catches up on its own
        // timer, so this is a delay rather than a fault.
        this.logger.debug(`Could not reach the storefront to revalidate: ${error.message}`);
      })
      .finally(() => clearTimeout(timeout));
  }
}
