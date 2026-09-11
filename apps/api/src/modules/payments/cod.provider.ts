import { Injectable } from '@nestjs/common';
import type { PaymentIntent, PaymentProvider, PaymentSession, WebhookResult } from './payment-provider.js';
import { WebhookVerificationError } from './payment-provider.js';

/**
 * Cash on delivery — the default, and the only provider that always works.
 *
 * It is a real implementation rather than a null object: an order placed with it is
 * immediately valid and unpaid, and it becomes paid when a driver or courier hands the
 * money in. That transition lives in the order state machine, not here, because the
 * money arrives days later through a completely different door.
 */
@Injectable()
export class CodProvider implements PaymentProvider {
  readonly key = 'cod';
  readonly label = 'Paiement à la livraison';
  readonly redirects = false;

  async isConfigured(): Promise<boolean> {
    // Nothing to configure: the shop already has drivers or a courier.
    return true;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    // There is nothing to reach. Saying so is more useful than a disabled button.
    return { ok: true, message: 'Le paiement à la livraison ne dépend d’aucun service.' };
  }

  async createSession(intent: PaymentIntent): Promise<PaymentSession> {
    return {
      provider: this.key,
      checkoutUrl: null,
      // The order number is the reference: it is what the driver reads off the label
      // and what the cash reconciliation matches against.
      reference: intent.orderNumber,
      status: 'pending',
    };
  }

  async parseWebhook(): Promise<WebhookResult> {
    // There is no gateway to receive a webhook from. Refusing loudly is right: a
    // request reaching here means something is misrouted.
    throw new WebhookVerificationError('Cash on delivery has no webhooks');
  }
}
