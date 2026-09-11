import { BadRequestException, Injectable } from '@nestjs/common';
import { ChargilyProvider } from './chargily.provider.js';
import { CodProvider } from './cod.provider.js';
import { SettingsService } from '../settings/settings.service.js';
import type { PaymentProvider } from './payment-provider.js';

/**
 * The registry of payment providers — PRD F-ST-45, Settings › Payments.
 *
 * Cash on delivery is always present and is the fallback for everything: a shop whose
 * card gateway is misconfigured must still be able to sell, because in Algeria the card
 * gateway is the option and COD is the norm.
 */
@Injectable()
export class PaymentsService {
  private readonly providers: PaymentProvider[];

  constructor(
    cod: CodProvider,
    chargily: ChargilyProvider,
    private readonly settings: SettingsService,
  ) {
    this.providers = [cod, chargily];
  }

  /** The providers a shopper may actually choose right now. */
  async available(): Promise<Array<{ key: string; label: string; redirects: boolean }>> {
    const out: Array<{ key: string; label: string; redirects: boolean }> = [];
    for (const provider of this.providers) {
      if (await provider.isConfigured()) {
        out.push({ key: provider.key, label: provider.label, redirects: provider.redirects });
      }
    }
    return out;
  }

  /**
   * Resolves a provider by key, falling back to the shop's default and then to COD.
   *
   * The fallback is deliberate. A shopper whose chosen provider stopped working between
   * loading the page and pressing the button should end up with a cash-on-delivery
   * order, not an error.
   */
  async resolve(key?: string | null): Promise<PaymentProvider> {
    const wanted = key ?? (await this.settings.get<string>('payments.default_provider', 'cod'));

    const chosen = this.providers.find((provider) => provider.key === wanted);
    if (chosen && (await chosen.isConfigured())) return chosen;

    const cod = this.providers.find((provider) => provider.key === 'cod');
    if (cod) return cod;

    throw new BadRequestException({
      code: 'NO_PAYMENT_PROVIDER',
      message: 'No payment method is available right now',
    });
  }

  byKey(key: string): PaymentProvider | null {
    return this.providers.find((provider) => provider.key === key) ?? null;
  }

  /** Every provider with whether it is switched on, for Settings › Paiements. */
  async describe(): Promise<
    Array<{ key: string; label: string; redirects: boolean; configured: boolean }>
  > {
    return Promise.all(
      this.providers.map(async (provider) => ({
        key: provider.key,
        label: provider.label,
        redirects: provider.redirects,
        configured: await provider.isConfigured(),
      })),
    );
  }

  /**
   * Asks one provider whether its configuration actually works.
   *
   * The button exists because a key that is present and wrong reads as configured
   * everywhere else and fails at checkout, in front of a customer.
   */
  async testConnection(key: string): Promise<{ ok: boolean; message: string }> {
    const provider = this.byKey(key);
    if (!provider) {
      throw new BadRequestException({
        code: 'UNKNOWN_PAYMENT_PROVIDER',
        message: `Moyen de paiement inconnu : ${key}`,
      });
    }
    return provider.testConnection();
  }
}
