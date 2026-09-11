import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module.js';
import { ContentAdminService } from './content-admin.service.js';
import {
  AnnouncementsController,
  BannersController,
  HomeSectionsController,
  MarketingController,
  MenusController,
  PagesController,
  RedirectsController,
} from './content.controller.js';
import { MarketingService } from './marketing.service.js';
import { BrevoNewsletterProvider, LogNewsletterProvider } from './newsletter-provider.js';

/**
 * Content and marketing — PRD F-AD-90/91.
 *
 * `SystemModule` comes in for the decryption of the newsletter provider's credentials,
 * which are stored the same way every other integration's are.
 */
@Module({
  imports: [SystemModule],
  controllers: [
    HomeSectionsController,
    BannersController,
    AnnouncementsController,
    PagesController,
    MenusController,
    RedirectsController,
    MarketingController,
  ],
  providers: [
    ContentAdminService,
    MarketingService,
    LogNewsletterProvider,
    BrevoNewsletterProvider,
  ],
  exports: [ContentAdminService, MarketingService],
})
export class ContentModule {}
