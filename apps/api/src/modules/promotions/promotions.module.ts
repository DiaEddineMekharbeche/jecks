import { Global, Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service.js';

/**
 * The promo engine and its database side — PRD F-AD-20/21.
 *
 * Global because the cart, the checkout and the admin simulator all evaluate the same
 * rules, and three modules importing it would be three chances to import a second copy
 * with different state.
 */
@Global()
@Module({
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
