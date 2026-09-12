import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sanitizeTranslatedRichText } from '../../common/html/rich-text.js';
import type { Prisma } from '@jecks/db';
import {
  CONTENT_ERRORS,
  type AnnouncementDto,
  type AnnouncementInput,
  type BannerDto,
  type BannerInput,
  type BannerPlacement,
  type HomeSectionDto,
  type HomeSectionInput,
  type HomeSectionKind,
  type MenuDto,
  type MenuInput,
  type MenuItemDto,
  type MenuItemInput,
  type PageDetail,
  type PageInput,
  type PageKind,
  type PageRow,
  type RedirectInput,
  type RedirectRow,
  type ReorderInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Everything a shop changes without a developer — PRD F-AD-90/91.
 *
 * One rule runs through all of it: anything scheduled carries a window and the
 * storefront filters on read. A banner for a sale that ended at midnight disappears by
 * itself, rather than waiting for somebody to remember to switch it off.
 */
@Injectable()
export class ContentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // --- home sections --------------------------------------------------------

  async listHomeSections(): Promise<HomeSectionDto[]> {
    const sections = await this.prisma.homeSection.findMany({
      orderBy: { position: 'asc' },
      include: {
        media: { select: { storageKey: true } },
        collection: { select: { name: true } },
      },
    });

    const now = new Date();
    return sections.map((section) => ({
      id: section.id,
      kind: section.kind as HomeSectionKind,
      title: section.title as Translated | null,
      subtitle: section.subtitle as Translated | null,
      ctaLabel: section.ctaLabel as Translated | null,
      ctaUrl: section.ctaUrl,
      mediaId: section.mediaId,
      mediaUrl: section.media ? this.storage.publicUrl(section.media.storageKey) : null,
      collectionId: section.collectionId,
      collectionName: (section.collection?.name as Translated | undefined) ?? null,
      productId: section.productId,
      config: (section.config as Record<string, unknown> | null) ?? null,
      position: section.position,
      active: section.active,
      startsAt: section.startsAt?.toISOString() ?? null,
      endsAt: section.endsAt?.toISOString() ?? null,
      live: isLive(section, now),
    }));
  }

  async createHomeSection(input: HomeSectionInput): Promise<HomeSectionDto> {
    await this.prisma.homeSection.create({ data: this.homeSectionData(input) });
    return (await this.listHomeSections()).find((section) => section.position === input.position)!;
  }

  async updateHomeSection(id: string, input: HomeSectionInput): Promise<HomeSectionDto[]> {
    const existing = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Section not found' });

    await this.prisma.homeSection.update({ where: { id }, data: this.homeSectionData(input) });
    return this.listHomeSections();
  }

  async removeHomeSection(id: string): Promise<void> {
    await this.prisma.homeSection.deleteMany({ where: { id } });
  }

  /** Applies a dragged order in one transaction, so the page never renders half-sorted. */
  async reorderHomeSections(input: ReorderInput): Promise<HomeSectionDto[]> {
    await this.prisma.$transaction(
      input.ids.map((id, index) =>
        this.prisma.homeSection.updateMany({ where: { id }, data: { position: index } }),
      ),
    );
    return this.listHomeSections();
  }

  private homeSectionData(input: HomeSectionInput): Prisma.HomeSectionUncheckedCreateInput {
    return {
      kind: input.kind,
      title: (input.title ?? undefined) as Prisma.InputJsonValue | undefined,
      subtitle: (input.subtitle ?? undefined) as Prisma.InputJsonValue | undefined,
      ctaLabel: (input.ctaLabel ?? undefined) as Prisma.InputJsonValue | undefined,
      ctaUrl: input.ctaUrl ?? null,
      mediaId: input.mediaId ?? null,
      collectionId: input.collectionId ?? null,
      productId: input.productId ?? null,
      config: (input.config ?? undefined) as Prisma.InputJsonValue | undefined,
      position: input.position,
      active: input.active,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
  }

  // --- banners --------------------------------------------------------------

  async listBanners(): Promise<BannerDto[]> {
    const banners = await this.prisma.banner.findMany({
      orderBy: [{ placement: 'asc' }, { position: 'asc' }],
      include: { media: { select: { storageKey: true } } },
    });

    const now = new Date();
    return banners.map((banner) => ({
      id: banner.id,
      name: banner.name,
      placement: banner.placement as BannerPlacement,
      title: banner.title as Translated | null,
      subtitle: banner.subtitle as Translated | null,
      ctaLabel: banner.ctaLabel as Translated | null,
      ctaUrl: banner.ctaUrl,
      mediaId: banner.mediaId,
      mediaUrl: banner.media ? this.storage.publicUrl(banner.media.storageKey) : null,
      position: banner.position,
      active: banner.active,
      startsAt: banner.startsAt?.toISOString() ?? null,
      endsAt: banner.endsAt?.toISOString() ?? null,
      live: isLive(banner, now),
    }));
  }

  async createBanner(input: BannerInput): Promise<BannerDto[]> {
    await this.prisma.banner.create({ data: this.bannerData(input) });
    return this.listBanners();
  }

  async updateBanner(id: string, input: BannerInput): Promise<BannerDto[]> {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Banner not found' });

    await this.prisma.banner.update({ where: { id }, data: this.bannerData(input) });
    return this.listBanners();
  }

  async removeBanner(id: string): Promise<void> {
    await this.prisma.banner.deleteMany({ where: { id } });
  }

  private bannerData(input: BannerInput): Prisma.BannerUncheckedCreateInput {
    return {
      name: input.name,
      placement: input.placement,
      title: (input.title ?? undefined) as Prisma.InputJsonValue | undefined,
      subtitle: (input.subtitle ?? undefined) as Prisma.InputJsonValue | undefined,
      ctaLabel: (input.ctaLabel ?? undefined) as Prisma.InputJsonValue | undefined,
      ctaUrl: input.ctaUrl ?? null,
      mediaId: input.mediaId ?? null,
      position: input.position,
      active: input.active,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
  }

  // --- announcements --------------------------------------------------------

  async listAnnouncements(): Promise<AnnouncementDto[]> {
    const announcements = await this.prisma.announcement.findMany({
      orderBy: { position: 'asc' },
    });

    const now = new Date();
    return announcements.map((announcement) => ({
      id: announcement.id,
      message: announcement.message as Translated,
      linkUrl: announcement.linkUrl,
      bgColor: announcement.bgColor,
      textColor: announcement.textColor,
      position: announcement.position,
      active: announcement.active,
      startsAt: announcement.startsAt?.toISOString() ?? null,
      endsAt: announcement.endsAt?.toISOString() ?? null,
      live: isLive(announcement, now),
    }));
  }

  async createAnnouncement(input: AnnouncementInput): Promise<AnnouncementDto[]> {
    await this.prisma.announcement.create({ data: this.announcementData(input) });
    return this.listAnnouncements();
  }

  async updateAnnouncement(id: string, input: AnnouncementInput): Promise<AnnouncementDto[]> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Announcement not found' });
    }

    await this.prisma.announcement.update({ where: { id }, data: this.announcementData(input) });
    return this.listAnnouncements();
  }

  async removeAnnouncement(id: string): Promise<void> {
    await this.prisma.announcement.deleteMany({ where: { id } });
  }

  private announcementData(input: AnnouncementInput): Prisma.AnnouncementUncheckedCreateInput {
    return {
      message: input.message as Prisma.InputJsonValue,
      linkUrl: input.linkUrl ?? null,
      bgColor: input.bgColor ?? null,
      textColor: input.textColor ?? null,
      position: input.position,
      active: input.active,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
  }

  // --- pages ----------------------------------------------------------------

  async listPages(kind?: string): Promise<PageRow[]> {
    const pages = await this.prisma.page.findMany({
      where: { deletedAt: null, ...(kind ? { kind } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        kind: true,
        published: true,
        publishedAt: true,
        updatedAt: true,
      },
    });

    return pages.map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title as Translated,
      kind: page.kind as PageKind,
      published: page.published,
      publishedAt: page.publishedAt?.toISOString() ?? null,
      updatedAt: page.updatedAt.toISOString(),
    }));
  }

  async getPage(id: string): Promise<PageDetail> {
    const page = await this.prisma.page.findFirst({
      where: { id, deletedAt: null },
      include: { hero: { select: { storageKey: true } } },
    });
    if (!page) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Page not found' });

    return {
      id: page.id,
      slug: page.slug,
      title: page.title as Translated,
      body: page.body as Translated,
      excerpt: page.excerpt as Translated | null,
      heroMediaId: page.heroMediaId,
      heroUrl: page.hero ? this.storage.publicUrl(page.hero.storageKey) : null,
      seoTitle: page.seoTitle as Translated | null,
      seoDescription: page.seoDescription as Translated | null,
      kind: page.kind as PageKind,
      published: page.published,
      publishedAt: page.publishedAt?.toISOString() ?? null,
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  async createPage(input: PageInput): Promise<PageDetail> {
    await this.assertSlugFree(input.slug, null);

    const page = await this.prisma.page.create({ data: this.pageData(input, null) });
    return this.getPage(page.id);
  }

  async updatePage(id: string, input: PageInput): Promise<PageDetail> {
    const existing = await this.prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Page not found' });

    await this.assertSlugFree(input.slug, id);

    await this.prisma.page.update({
      where: { id },
      data: this.pageData(input, existing.publishedAt),
    });

    // A published page whose address changed leaves a dead link behind unless somebody
    // catches it; the redirect is written here rather than being remembered later.
    if (existing.slug !== input.slug && existing.published) {
      await this.prisma.redirect.upsert({
        where: { fromPath: `/${existing.slug}` },
        create: { fromPath: `/${existing.slug}`, toPath: `/${input.slug}`, statusCode: 301 },
        update: { toPath: `/${input.slug}` },
      });
    }

    return this.getPage(id);
  }

  /** Soft delete: a page that was linked from elsewhere is still worth recovering. */
  async removePage(id: string): Promise<void> {
    const page = await this.prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Page not found' });

    await this.prisma.page.update({ where: { id }, data: { deletedAt: new Date(), published: false } });
  }

  private pageData(input: PageInput, publishedAt: Date | null): Prisma.PageUncheckedCreateInput {
    return {
      slug: input.slug,
      title: input.title as Prisma.InputJsonValue,
      // Cleaned on the way in: the storefront renders this with dangerouslySetInnerHTML,
      // so a <script> typed here would run on every visitor's browser.
      body: sanitizeTranslatedRichText(input.body) as Prisma.InputJsonValue,
      excerpt: (input.excerpt ?? undefined) as Prisma.InputJsonValue | undefined,
      heroMediaId: input.heroMediaId ?? null,
      seoTitle: (input.seoTitle ?? undefined) as Prisma.InputJsonValue | undefined,
      seoDescription: (input.seoDescription ?? undefined) as Prisma.InputJsonValue | undefined,
      kind: input.kind,
      published: input.published,
      // First publication stamps the date; re-publishing keeps the original.
      publishedAt: input.published ? (publishedAt ?? new Date()) : null,
    };
  }

  private async assertSlugFree(slug: string, exceptId: string | null): Promise<void> {
    const clash = await this.prisma.page.findFirst({
      where: { slug, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });

    if (clash) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.SLUG_TAKEN,
        message: 'Une page utilise déjà cette adresse',
        details: { field: 'slug' },
      });
    }
  }

  // --- menus ----------------------------------------------------------------

  async listMenus(): Promise<MenuDto[]> {
    const menus = await this.prisma.menu.findMany({
      orderBy: { slug: 'asc' },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    return menus.map((menu) => ({
      id: menu.id,
      slug: menu.slug,
      name: menu.name as Translated,
      items: buildTree(menu.items),
    }));
  }

  async createMenu(input: MenuInput): Promise<MenuDto[]> {
    const existing = await this.prisma.menu.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.SLUG_TAKEN,
        message: 'Un menu utilise déjà cet identifiant',
        details: { field: 'slug' },
      });
    }

    await this.prisma.menu.create({
      data: { slug: input.slug, name: input.name as Prisma.InputJsonValue },
    });
    return this.listMenus();
  }

  async removeMenu(id: string): Promise<void> {
    await this.prisma.menu.deleteMany({ where: { id } });
  }

  async addMenuItem(menuId: string, input: MenuItemInput): Promise<MenuDto[]> {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Menu not found' });

    await this.prisma.menuItem.create({
      data: {
        menuId,
        parentId: input.parentId ?? null,
        label: input.label as Prisma.InputJsonValue,
        url: input.url,
        imageKey: input.imageKey ?? null,
        position: input.position,
        openInNewTab: input.openInNewTab,
      },
    });

    return this.listMenus();
  }

  async updateMenuItem(itemId: string, input: MenuItemInput): Promise<MenuDto[]> {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item not found' });

    // A menu item cannot be its own parent, however the client asks.
    const parentId = input.parentId === itemId ? null : (input.parentId ?? null);

    await this.prisma.menuItem.update({
      where: { id: itemId },
      data: {
        parentId,
        label: input.label as Prisma.InputJsonValue,
        url: input.url,
        imageKey: input.imageKey ?? null,
        position: input.position,
        openInNewTab: input.openInNewTab,
      },
    });

    return this.listMenus();
  }

  async removeMenuItem(itemId: string): Promise<MenuDto[]> {
    await this.prisma.menuItem.deleteMany({ where: { id: itemId } });
    return this.listMenus();
  }

  async reorderMenuItems(input: ReorderInput): Promise<MenuDto[]> {
    await this.prisma.$transaction(
      input.ids.map((id, index) =>
        this.prisma.menuItem.updateMany({ where: { id }, data: { position: index } }),
      ),
    );
    return this.listMenus();
  }

  // --- redirects ------------------------------------------------------------

  async listRedirects(): Promise<RedirectRow[]> {
    const redirects = await this.prisma.redirect.findMany({
      orderBy: [{ hits: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return redirects.map((redirect) => ({
      id: redirect.id,
      fromPath: redirect.fromPath,
      toPath: redirect.toPath,
      statusCode: redirect.statusCode,
      hits: redirect.hits,
      createdAt: redirect.createdAt.toISOString(),
    }));
  }

  /**
   * Adds a redirect, refusing one that would chain into a loop.
   *
   * A → B when B → A already exists sends a visitor round forever, and the browser is
   * what tells them so. Catching it here costs one query.
   */
  async createRedirect(input: RedirectInput): Promise<RedirectRow[]> {
    const reverse = await this.prisma.redirect.findFirst({
      where: { fromPath: input.toPath, toPath: input.fromPath },
      select: { id: true },
    });

    if (reverse) {
      throw new BadRequestException({
        code: CONTENT_ERRORS.REDIRECT_LOOP,
        message: `${input.toPath} redirige déjà vers ${input.fromPath}`,
      });
    }

    await this.prisma.redirect.upsert({
      where: { fromPath: input.fromPath },
      create: { fromPath: input.fromPath, toPath: input.toPath, statusCode: input.statusCode },
      update: { toPath: input.toPath, statusCode: input.statusCode },
    });

    return this.listRedirects();
  }

  async removeRedirect(id: string): Promise<void> {
    await this.prisma.redirect.deleteMany({ where: { id } });
  }
}

/** Active, and inside its window if it has one. */
function isLive(
  entity: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): boolean {
  if (!entity.active) return false;
  if (entity.startsAt && entity.startsAt > now) return false;
  if (entity.endsAt && entity.endsAt < now) return false;
  return true;
}

/** Flat rows into the tree the menu editor and the header both render. */
function buildTree(
  items: Array<{
    id: string;
    parentId: string | null;
    label: unknown;
    url: string;
    imageKey: string | null;
    position: number;
    openInNewTab: boolean;
  }>,
): MenuItemDto[] {
  const byId = new Map<string, MenuItemDto>();
  for (const item of items) {
    byId.set(item.id, {
      id: item.id,
      parentId: item.parentId,
      label: item.label as Translated,
      url: item.url,
      imageKey: item.imageKey,
      position: item.position,
      openInNewTab: item.openInNewTab,
      children: [],
    });
  }

  const roots: MenuItemDto[] = [];
  for (const item of byId.values()) {
    // An item whose parent was deleted becomes a root rather than disappearing.
    const parent = item.parentId ? byId.get(item.parentId) : null;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }

  return roots;
}
