/**
 * Payment providers — PRD F-ST-45 and Settings › Payments.
 *
 * Cash on delivery is the default and always available: it is how the overwhelming
 * majority of Algerian e-commerce is paid for, and a shop must be able to trade with
 * nothing else configured.
 *
 * An online provider is an addition, never a replacement, so the interface is shaped
 * around "this order may or may not need a redirect" rather than around a card flow.
 */

export interface PaymentIntent {
  orderId: string;
  orderNumber: string;
  amountMinor: bigint;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  /** Where the provider sends the shopper once they are done. */
  returnUrl: string;
  /** Where the provider posts the result. */
  webhookUrl: string;
  description: string;
}

export interface PaymentSession {
  provider: string;
  /** Null for a provider that needs no redirect, which is what COD is. */
  checkoutUrl: string | null;
  /** The provider's own id for this attempt, stored on the `Payment` row. */
  reference: string | null;
  status: 'pending' | 'paid' | 'failed';
}

export interface WebhookResult {
  /** Our order number or id, as the provider echoed it back. */
  orderRef: string;
  reference: string;
  status: 'paid' | 'failed' | 'cancelled' | 'pending';
  amountMinor: bigint;
  raw: unknown;
}

export interface PaymentProvider {
  readonly key: string;
  readonly label: string;
  /** True when the shopper is redirected away and comes back. */
  readonly redirects: boolean;

  /** Whether the shop has configured enough for this provider to work. */
  isConfigured(): Promise<boolean>;

  /**
   * Does the configuration actually work?
   *
   * `isConfigured` only says the key is present. A key that is present and wrong reads
   * as configured and fails at the one moment it matters, which is a shopper trying to
   * pay. This asks the provider, read-only, and never creates anything.
   */
  testConnection(): Promise<{ ok: boolean; message: string }>;

  createSession(intent: PaymentIntent): Promise<PaymentSession>;

  /**
   * Verifies a webhook body against its signature and maps it onto our vocabulary.
   * Throws when the signature does not match; a caller must never treat an unverified
   * body as a payment.
   */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult>;
}

export class PaymentConfigurationError extends Error {
  readonly code = 'PAYMENT_NOT_CONFIGURED';
  constructor(provider: string) {
    super(`The ${provider} payment provider is not configured`);
    this.name = 'PaymentConfigurationError';
  }
}

export class WebhookVerificationError extends Error {
  readonly code = 'WEBHOOK_INVALID';
  constructor(message = 'The webhook signature does not match') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
