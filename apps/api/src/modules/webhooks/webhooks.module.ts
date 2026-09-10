import { Module } from '@nestjs/common';
import { CouriersModule } from '../couriers/couriers.module.js';
import { DeliveryModule } from '../delivery/delivery.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * Everything that arrives unannounced from outside — PRD F-AD-61 and F-ST-45.
 *
 * One module, so the "verify against the raw body first" rule lives in one place rather
 * than being restated in each integration.
 */
@Module({
  imports: [CouriersModule, DeliveryModule, PaymentsModule, OrdersModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
