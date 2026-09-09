import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from './settings.service.js';

@ApiTags('storefront')
@Controller('storefront')
export class StorefrontController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('bootstrap')
  @ApiOperation({ summary: 'Settings, menus and announcements the storefront needs on first paint' })
  async bootstrap() {
    const [settings, menus, announcements] = await Promise.all([
      this.settings.publicSettings(),
      this.prisma.menu.findMany({
        select: {
          slug: true,
          items: {
            orderBy: { position: 'asc' },
            select: { id: true, parentId: true, label: true, url: true, position: true },
          },
        },
      }),
      this.prisma.announcement.findMany({
        where: {
          active: true,
          OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }],
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }],
        },
        orderBy: { position: 'asc' },
        select: { id: true, message: true, linkUrl: true, bgColor: true, textColor: true },
      }),
    ]);
    return { settings, menus, announcements };
  }

  @Public()
  @Get('home')
  @ApiOperation({ summary: 'Home page sections in display order (F-AD-23)' })
  async home() {
    return this.prisma.homeSection.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }],
      },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        kind: true,
        title: true,
        subtitle: true,
        ctaLabel: true,
        ctaUrl: true,
        config: true,
        position: true,
        media: { select: { storageKey: true, alt: true } },
        collection: { select: { slug: true, name: true } },
      },
    });
  }

  @Public()
  @Get('pages')
  @ApiOperation({ summary: 'Published CMS pages, for the footer and the sitemap' })
  async pages() {
    return this.prisma.page.findMany({
      where: { published: true, deletedAt: null },
      orderBy: { slug: 'asc' },
      select: { slug: true, title: true, kind: true, updatedAt: true },
    });
  }

  @Public()
  @Get('pages/:slug')
  @ApiOperation({ summary: 'One published CMS page' })
  async page(@Param('slug') slug: string) {
    const page = await this.prisma.page.findFirst({
      where: { slug, published: true, deletedAt: null },
      select: { slug: true, title: true, body: true, kind: true, updatedAt: true },
    });
    if (!page) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That page does not exist' });
    }
    return page;
  }

  /** Feeds sitemap.xml: every URL the storefront wants indexed, with its last change. */
  @Public()
  @Get('sitemap')
  @ApiOperation({ summary: 'Slugs and timestamps for sitemap generation' })
  async sitemap() {
    const [products, collections, categories, pages] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE', deletedAt: null, publishedAt: { not: null } },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.collection.findMany({
        where: { published: true, deletedAt: null },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.category.findMany({
        where: { published: true, deletedAt: null },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.page.findMany({
        where: { published: true, deletedAt: null },
        select: { slug: true, updatedAt: true },
      }),
    ]);
    return { products, collections, categories, pages };
  }
}
