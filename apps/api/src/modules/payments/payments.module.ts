import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module.js';
import { ChargilyProvider } from './chargily.provider.js';
import { CodProvider } from './cod.provider.js';
import { PaymentProvidersController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Payment providers — PRD F-ST-45.
 *
 * Cash on delivery is always registered; an online provider is an addition the owner
 * switches on in Settings › Payments. `SystemModule` comes in for the decryption of the
 * stored credentials.
 */
@Module({
  imports: [SystemModule],
  controllers: [PaymentProvidersController],
  providers: [CodProvider, ChargilyProvider, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
