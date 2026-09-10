import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { checkoutSchema, type CheckoutInput } from '@jecks/shared';
import type { Request } from 'express';
import { Public, type RequestWithUser } from '../../common/decorators/auth.decorators.js';
import { Idempotent, headerKey } from '../../common/idempotency/idempotency.guard.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CheckoutService } from './checkout.service.js';

/**
 * Placing an order — PRD F-ST-42.
 *
 * Public, because guest checkout is the whole point: an Algerian shopper buying a cap
 * should not have to make an account first, and requiring one is the largest single
 * source of abandonment on a COD store.
 */
@ApiTags('orders')
@Controller('orders')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @Public()
  @Idempotent()
  // Placing an order is a deliberate, slow act. Ten a minute from one address is not.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Place a cash-on-delivery order from the current cart' })
  place(@Body(zod(checkoutSchema)) body: CheckoutInput, @Req() request: Request) {
    const user = (request as RequestWithUser).user;

    return this.checkout.place(body, {
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      customerId: user?.type === 'CUSTOMER' ? user.id : null,
      idempotencyKey: headerKey(request as never),
    });
  }
}
