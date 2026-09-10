import { Global, Module } from '@nestjs/common';
import { PromotionsAdminService } from './promotions-admin.service.js';
import { PromotionsController } from './promotions.controller.js';
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
  controllers: [PromotionsController],
  providers: [PromotionsService, PromotionsAdminService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
