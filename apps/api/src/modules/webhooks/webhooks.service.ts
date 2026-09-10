import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { OrderStatus, PaymentMethod } from '@jecks/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CourierRegistry } from '../couriers/courier-registry.service.js';
import { CourierWebhookError } from '../couriers/courier-provider.js';
import { ShipmentsService } from '../delivery/shipments.service.js';
import { OrderTransitionService } from '../orders/order-transition.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { WebhookVerificationError } from '../payments/payment-provider.js';

/** Webhooks act as the system, not as a person; the journal says so. */
const SYSTEM_ACTOR = { id: null, name: 'Webhook' };

/**
 * What happens after a webhook is verified — PRD F-AD-61, F-ST-45.
 *
 * Kept apart from the controller so the verification-then-apply order is visible in one
 * place, and so the same application path serves the polling job.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CourierRegistry,
    private readonly shipments: ShipmentsService,
    private readonly payments: PaymentsService,
    private readonly transitions: OrderTransitionService,
  ) {}

  /**
   * A courier's status callback.
   *
   * The provider in the path is the adapter, not the courier row: two couriers can use
   * the same integration, so credentials are tried per configured courier until one
   * verifies. That loop is what makes a shared endpoint safe.
   */
  async handleCourier(
    provider: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: number; applied: number }> {
    const adapter = this.registry.adapterFor(provider);
    if (!adapter.supportsWebhook) {
      throw new BadRequestException({
        code: 'NOT_SUPPORTED',
        message: `${adapter.label} does not send webhooks`,
      });
    }

    const couriers = await this.prisma.courier.findMany({
      where: { provider, active: true },
      select: { id: true },
    });

    let updates = null;
    for (const courier of couriers) {
      const credentials = await this.registry.credentialsFor(courier.id);
      try {
        updates = await adapter.parseWebhook(rawBody, headers, credentials);
        break;
      } catch (error) {
        if (error instanceof CourierWebhookError) continue;
        throw error;
      }
    }

    if (!updates) {
      // No configured courier could verify it. That is either a forgery or a courier
      // whose secret we no longer hold, and both deserve a 401 rather than silence.
      this.logger.warn(`Unverified ${provider} webhook rejected`);
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE',
        message: 'Signature verification failed',
      });
    }

    let applied = 0;
    for (const update of updates) {
      const result = await this.shipments.applyUpdate(update, SYSTEM_ACTOR);
      if (result === 'applied') applied += 1;
      if (result === 'unknown') {
        // Accepted and ignored: a parcel we do not know is not our problem to retry.
        this.logger.warn(`${provider} reported an unknown parcel ${update.trackingNumber}`);
      }
    }

    return { received: updates.length, applied };
  }

  /**
   * A payment gateway's callback.
   *
   * A paid webhook records the payment and asks the state machine to confirm the order.
   * It is idempotent on the provider's own reference, because gateways resend.
   */
  async handlePayment(
    provider: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const adapter = this.payments.byKey(provider);
    if (!adapter) {
      throw new BadRequestException({ code: 'NOT_SUPPORTED', message: 'Unknown payment provider' });
    }

    let result;
    try {
      result = await adapter.parseWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        this.logger.warn(`Unverified ${provider} payment webhook rejected`);
        throw new UnauthorizedException({
          code: 'WEBHOOK_SIGNATURE',
          message: 'Signature verification failed',
        });
      }
      throw error;
    }

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ number: result.orderRef }, { id: result.orderRef }] },
      select: { id: true, number: true, status: true, total: true, paidTotal: true },
    });
    if (!order) {
      this.logger.warn(`${provider} reported a payment for unknown order ${result.orderRef}`);
      return;
    }

    const existing = await this.prisma.payment.findFirst({
      where: { orderId: order.id, provider, providerRef: result.reference },
      select: { id: true },
    });
    if (existing) return;

    if (result.status !== 'paid') {
      this.logger.log(`${provider} reported ${result.status} for ${order.number}`);
      return;
    }

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        method: PaymentMethod.CARD,
        amount: result.amountMinor,
        status: 'captured',
        provider,
        providerRef: result.reference,
        metadata: { source: 'webhook' },
      },
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'PAID', paidTotal: result.amountMinor },
    });

    // A paid order is one a human no longer needs to ring to confirm.
    if (order.status === OrderStatus.PENDING) {
      await this.transitions
        .transition(order.id, { to: OrderStatus.CONFIRMED, reason: 'Paiement en ligne reçu' }, SYSTEM_ACTOR)
        .catch((error: Error) => {
          this.logger.warn(`Order ${order.number} would not confirm: ${error.message}`);
        });
    }
  }
}
