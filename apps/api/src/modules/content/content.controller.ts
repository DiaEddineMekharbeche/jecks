import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  affiliateInputSchema,
  announcementInputSchema,
  bannerInputSchema,
  contactCartSchema,
  homeSectionInputSchema,
  menuInputSchema,
  menuItemInputSchema,
  newsletterSyncSchema,
  pageInputSchema,
  redirectInputSchema,
  reorderSchema,
  type AffiliateInput,
  type AnnouncementInput,
  type BannerInput,
  type ContactCartInput,
  type HomeSectionInput,
  type MenuInput,
  type MenuItemInput,
  type NewsletterSyncInput,
  type PageInput,
  type RedirectInput,
  type ReorderInput,
} from '@jecks/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { ContentAdminService } from './content-admin.service.js';
import { MarketingService } from './marketing.service.js';

/** The home page an owner assembles — PRD F-AD-90. */
@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('home_section')
@Controller('admin/content/home')
export class HomeSectionsController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Home sections in the order they are drawn' })
  list() {
    return this.content.listHomeSections();
  }

  @Post()
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Add a section' })
  create(@Body(zod(homeSectionInputSchema)) body: HomeSectionInput) {
    return this.content.createHomeSection(body);
  }

  @Patch(':id')
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Update a section' })
  update(@Param('id') id: string, @Body(zod(homeSectionInputSchema)) body: HomeSectionInput) {
    return this.content.updateHomeSection(id, body);
  }

  @Post('reorder')
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Apply a dragged order, in one transaction' })
  reorder(@Body(zod(reorderSchema)) body: ReorderInput) {
    return this.content.reorderHomeSections(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Remove a section' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removeHomeSection(id);
  }
}

@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('banner')
@Controller('admin/content/banners')
export class BannersController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Banners, grouped by placement' })
  list() {
    return this.content.listBanners();
  }

  @Post()
  @RequirePermissions('content.write')
  create(@Body(zod(bannerInputSchema)) body: BannerInput) {
    return this.content.createBanner(body);
  }

  @Patch(':id')
  @RequirePermissions('content.write')
  update(@Param('id') id: string, @Body(zod(bannerInputSchema)) body: BannerInput) {
    return this.content.updateBanner(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removeBanner(id);
  }
}

@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('announcement')
@Controller('admin/content/announcements')
export class AnnouncementsController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'The strip above the header' })
  list() {
    return this.content.listAnnouncements();
  }

  @Post()
  @RequirePermissions('content.write')
  create(@Body(zod(announcementInputSchema)) body: AnnouncementInput) {
    return this.content.createAnnouncement(body);
  }

  @Patch(':id')
  @RequirePermissions('content.write')
  update(@Param('id') id: string, @Body(zod(announcementInputSchema)) body: AnnouncementInput) {
    return this.content.updateAnnouncement(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removeAnnouncement(id);
  }
}

@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('page')
@Controller('admin/content/pages')
export class PagesController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Pages, posts and legal notices' })
  list(@Query('kind') kind?: string) {
    return this.content.listPages(kind);
  }

  @Get(':id')
  @RequirePermissions('content.read')
  get(@Param('id') id: string) {
    return this.content.getPage(id);
  }

  @Post()
  @RequirePermissions('content.write')
  create(@Body(zod(pageInputSchema)) body: PageInput) {
    return this.content.createPage(body);
  }

  /** Renaming a published page writes the redirect rather than leaving a dead link. */
  @Patch(':id')
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Update a page; a changed address leaves a redirect behind' })
  update(@Param('id') id: string, @Body(zod(pageInputSchema)) body: PageInput) {
    return this.content.updatePage(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removePage(id);
  }
}

@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('menu')
@Controller('admin/content/menus')
export class MenusController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Menus with their items as a tree' })
  list() {
    return this.content.listMenus();
  }

  @Post()
  @RequirePermissions('content.write')
  create(@Body(zod(menuInputSchema)) body: MenuInput) {
    return this.content.createMenu(body);
  }

  @Post(':id/items')
  @RequirePermissions('content.write')
  addItem(@Param('id') id: string, @Body(zod(menuItemInputSchema)) body: MenuItemInput) {
    return this.content.addMenuItem(id, body);
  }

  @Patch('items/:itemId')
  @RequirePermissions('content.write')
  updateItem(@Param('itemId') itemId: string, @Body(zod(menuItemInputSchema)) body: MenuItemInput) {
    return this.content.updateMenuItem(itemId, body);
  }

  @Post('items/reorder')
  @RequirePermissions('content.write')
  reorderItems(@Body(zod(reorderSchema)) body: ReorderInput) {
    return this.content.reorderMenuItems(body);
  }

  @Delete('items/:itemId')
  @RequirePermissions('content.write')
  removeItem(@Param('itemId') itemId: string) {
    return this.content.removeMenuItem(itemId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removeMenu(id);
  }
}

@ApiTags('admin/content')
@ApiBearerAuth()
@AuditEntity('redirect')
@Controller('admin/content/redirects')
export class RedirectsController {
  constructor(private readonly content: ContentAdminService) {}

  @Get()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Redirects, most used first' })
  list() {
    return this.content.listRedirects();
  }

  @Post()
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Add a redirect; a loop is refused' })
  create(@Body(zod(redirectInputSchema)) body: RedirectInput) {
    return this.content.createRedirect(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.content.removeRedirect(id);
  }
}

/** Marketing — PRD F-AD-91. */
@ApiTags('admin/marketing')
@ApiBearerAuth()
@AuditEntity('marketing')
@Controller('admin/marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('newsletter')
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'The subscriber list' })
  subscribers(@Query('limit') limit?: string) {
    return this.marketing.listSubscribers(limit ? Math.min(Number(limit), 2000) : 500);
  }

  @Get('newsletter/stats')
  @NoAudit()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'How the list is growing, and where from' })
  newsletterStats() {
    return this.marketing.newsletterStats();
  }

  @Get('newsletter/providers')
  @NoAudit()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Providers the list can be copied to' })
  providers() {
    return this.marketing.newsletterProviders();
  }

  @Post('newsletter/sync')
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Copy the list to the configured provider' })
  sync(@Body(zod(newsletterSyncSchema)) body: NewsletterSyncInput) {
    return this.marketing.syncNewsletter(body);
  }

  @Get('abandoned-carts')
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Carts nobody finished' })
  carts(@Query('filter') filter?: string) {
    const allowed = ['open', 'contacted', 'recovered', 'all'] as const;
    const selected = allowed.find((entry) => entry === filter) ?? 'open';
    return this.marketing.listAbandonedCarts(selected);
  }

  @Get('abandoned-carts/stats')
  @NoAudit()
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Open, contacted, recovered and what each is worth' })
  cartStats() {
    return this.marketing.abandonedCartStats();
  }

  @Post('abandoned-carts/contact')
  @RequirePermissions('content.write')
  @ApiOperation({ summary: 'Queue a recovery message; each cart is contacted once' })
  contact(@Body(zod(contactCartSchema)) body: ContactCartInput) {
    return this.marketing.contactCarts(body);
  }

  @Get('affiliates')
  @RequirePermissions('content.read')
  @ApiOperation({ summary: 'Affiliates and what their code actually earned' })
  affiliates() {
    return this.marketing.listAffiliates();
  }

  @Post('affiliates')
  @RequirePermissions('content.write')
  createAffiliate(@Body(zod(affiliateInputSchema)) body: AffiliateInput) {
    return this.marketing.createAffiliate(body);
  }

  @Patch('affiliates/:id')
  @RequirePermissions('content.write')
  updateAffiliate(@Param('id') id: string, @Body(zod(affiliateInputSchema)) body: AffiliateInput) {
    return this.marketing.updateAffiliate(id, body);
  }

  @Delete('affiliates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content.write')
  async removeAffiliate(@Param('id') id: string): Promise<void> {
    await this.marketing.removeAffiliate(id);
  }
}
