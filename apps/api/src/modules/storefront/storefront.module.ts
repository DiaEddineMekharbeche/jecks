import { Module } from '@nestjs/common';
import { CatalogAdminModule } from '../catalog/admin/catalog-admin.module.js';
import { AccountService } from './account.service.js';
import { EngagementService } from './engagement.service.js';
import { ReviewsPublicService } from './reviews.service.js';
import {
  AccountController,
  EngagementController,
  ReviewsController,
  TrackingController,
} from './storefront.controller.js';

/**
 * Everything a shopper writes — reviews, wishlist, back-in-stock, newsletter, contact,
 * analytics, their own account and public order tracking (PRD Section 4).
 *
 * `CatalogAdminModule` comes in for `RollupsService`: an approved review has to move
 * the product's rating in the same request, and there is one owner of that column.
 */
@Module({
  imports: [CatalogAdminModule],
  controllers: [ReviewsController, EngagementController, AccountController, TrackingController],
  providers: [ReviewsPublicService, EngagementService, AccountService],
  exports: [AccountService],
})
export class StorefrontModule {}
