import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { PaymentsService } from './payments.service.js';

/**
 * Payment providers, for Settings › Paiements — PRD F-ST-45.
 *
 * The screen lets the owner pick a provider and paste its key. This is the part that
 * tells them whether the key works, because `isConfigured` only means "a value is
 * stored": a key pasted with a trailing space reads as configured everywhere and fails
 * at the one moment that matters, with a customer waiting.
 */
@ApiTags('admin/payments')
@ApiBearerAuth()
@AuditEntity('payment_provider')
@Controller('admin/payments')
export class PaymentProvidersController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('providers')
  @NoAudit()
  @RequirePermissions('settings.read')
  @ApiOperation({ summary: 'Payment providers and whether each is switched on' })
  providers() {
    return this.payments.describe();
  }

  @Post('providers/:key/test')
  @RequirePermissions('settings.write')
  @ApiOperation({ summary: 'Ask a provider whether its configuration actually works' })
  test(@Param('key') key: string) {
    return this.payments.testConnection(key);
  }
}
