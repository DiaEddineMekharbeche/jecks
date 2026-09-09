import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  CATALOG_ERRORS,
  type AdminListQuery,
  type AdminListResponse,
  type CollectionDetail,
  type CollectionInput,
  type CollectionPatchInput,
  type CollectionPreviewInput,
  type CollectionRow,
  type MerchandisingInput,
  type MerchandisingItem,
  type ProductRow,
  type Rendition,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  andWhere,
  listResponse,
  planList,
  searchFilter,
} from '../../../common/list/list.helper.js';
import { assertRulesValid, rulesToFilter } from '../collection-rules.js';

export const COLLECTION_SORTABLE = {
  position: 'position',
  name: 'slug',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

export interface CollectionListFilters {
  isSmart?: string[];
  published?: string[];
}

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // --- read -----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: CollectionListFilters,
  ): Promise<AdminListResponse<CollectionRow>> {
    const where = andWhere(
      { deletedAt: null },
      filters.isSmart?.length ? { isSmart: filters.isSmart[0] === 'true' } : undefined,
      filters.published?.length ? { published: filters.published[0] === 'true' } : undefined,
      searchFilter(query.q, ['slug']),
    ) as Prisma.CollectionWhereInput;

    const plan = planList(query, COLLECTION_SORTABLE, 'position');

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.collection.findMany({
        where,
        ...plan,
        include: {
          media: { select: { storageKey: true } },
          rules: true,
          _count: { select: { products: true, rules: true } },
        },
      }),
      this.prisma.collection.count({ where }),
    ]);

    // A smart collection has no membership rows to count, so its size is the live match
    // count. Counting per row is one indexed query each and keeps the number honest.
    const withCounts = await Promise.all(
      rows.map(async (row) => ({
        row,
        productCount: row.isSmart
          ? await this.countMatches(row.rules, row.matchAll)
          : row._count.products,
      })),
    );

    return listResponse(
      query,
      withCounts.map(({ row, productCount }) => ({
        id: row.id,
        name: (row.name ?? {}) as Translated,
        slug: row.slug,
        isSmart: row.isSmart,
        matchAll: row.matchAll,
        published: row.published,
        position: row.position,
        ruleCount: row._count.rules,
        productCount,
        mediaUrl: this.storage.publicUrl(row.media?.storageKey),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
    );
  }

  async get(id: string): Promise<CollectionDetail> {
    const collection = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      include: {
        media: { select: { storageKey: true } },
        hero: { select: { storageKey: true } },
        rules: { orderBy: { createdAt: 'asc' } },
        _count: { select: { products: true } },
      },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }

    return {
      id: collection.id,
      name: (collection.name ?? {}) as Translated,
      slug: collection.slug,
      description: (collection.description ?? null) as Translated | null,
      isSmart: collection.isSmart,
      matchAll: collection.matchAll,
      published: collection.published,
      position: collection.position,
      seoTitle: (collection.seoTitle ?? null) as Translated | null,
      seoDescription: (collection.seoDescription ?? null) as Translated | null,
      mediaId: collection.mediaId,
      heroMediaId: collection.heroMediaId,
      mediaUrl: this.storage.publicUrl(collection.media?.storageKey),
      heroUrl: this.storage.publicUrl(collection.hero?.storageKey),
      productCount: collection.isSmart
        ? await this.countMatches(collection.rules, collection.matchAll)
        : collection._count.products,
      rules: collection.rules.map((rule) => ({
        id: rule.id,
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
      })),
      updatedAt: collection.updatedAt.toISOString(),
    };
  }

  /**
   * What a rule set would select right now — the live preview under the rule builder.
   *
   * It runs the same translator the storefront runs, so what the operator sees here is
   * what shoppers will see, not an approximation of it.
   */
  async preview(input: CollectionPreviewInput): Promise<{ total: number; products: ProductRow[] }> {
    assertRulesValid(input.rules);
    const where = this.publishedAnd(rulesToFilter(input.rules, input.matchAll));

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        take: input.limit,
        orderBy: { salesCount: 'desc' },
        select: PREVIEW_SELECT,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { total, products: rows.map((row) => this.toPreviewRow(row)) };
  }

  /** The board behind the merchandising screen — PRD F-AD-13. */
  async members(id: string): Promise<MerchandisingItem[]> {
    const collection = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      include: { rules: true },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }

    if (collection.isSmart) {
      // A smart collection has no membership rows, so pins and boosts hang off the same
      // join table, created lazily the first time an operator touches a product.
      const matched = await this.prisma.product.findMany({
        where: this.publishedAnd(rulesToFilter(collection.rules, collection.matchAll)),
        orderBy: { salesCount: 'desc' },
        take: 500,
        select: PREVIEW_SELECT,
      });

      const overrides = await this.prisma.collectionProduct.findMany({
        where: { collectionId: id, productId: { in: matched.map((row) => row.id) } },
      });
      const byProduct = new Map(overrides.map((item) => [item.productId, item]));

      return matched
        .map((row, index) => {
          const override = byProduct.get(row.id);
          return this.toMerchandisingItem(row, {
            position: override?.position ?? index,
            pinned: override?.pinned ?? false,
            hidden: override?.hidden ?? false,
            boost: override?.boost ?? 0,
          });
        })
        .sort(byPinThenPosition);
    }

    const links = await this.prisma.collectionProduct.findMany({
      where: { collectionId: id, product: { deletedAt: null } },
      orderBy: [{ pinned: 'desc' }, { position: 'asc' }],
      include: { product: { select: PREVIEW_SELECT } },
    });

    return links.map((link) =>
      this.toMerchandisingItem(link.product, {
        position: link.position,
        pinned: link.pinned,
        hidden: link.hidden,
        boost: link.boost,
      }),
    );
  }

  // --- write ----------------------------------------------------------------

  async create(input: CollectionInput): Promise<CollectionDetail> {
    await this.assertSlugFree(input.slug);
    assertRulesValid(input.rules);

    const created = await this.prisma.collection.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
        isSmart: input.isSmart,
        matchAll: input.matchAll,
        mediaId: input.mediaId ?? null,
        position: input.position,
        published: input.published,
        rules: {
          create: input.rules.map((rule) => ({
            field: rule.field,
            operator: rule.operator,
            value: rule.value,
          })),
        },
        ...(input.isSmart || input.productIds.length === 0
          ? {}
          : {
              products: {
                create: input.productIds.map((productId, position) => ({ productId, position })),
              },
            }),
      },
      select: { id: true },
    });

    return this.get(created.id);
  }

  async update(id: string, input: CollectionPatchInput): Promise<CollectionDetail> {
    const current = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true, isSmart: true },
    });
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }
    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.assertSlugFree(input.slug, id);
    }
    if (input.rules) assertRulesValid(input.rules);

    const becomingSmart = input.isSmart ?? current.isSmart;
    if (becomingSmart && (input.rules ?? []).length === 0) {
      const existingRules = await this.prisma.collectionRule.count({ where: { collectionId: id } });
      if (existingRules === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'A smart collection needs at least one rule',
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CollectionUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name as Prisma.InputJsonValue;
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.description !== undefined) {
        data.description = input.description as Prisma.InputJsonValue;
      }
      if (input.isSmart !== undefined) data.isSmart = input.isSmart;
      if (input.matchAll !== undefined) data.matchAll = input.matchAll;
      if (input.mediaId !== undefined) data.mediaId = input.mediaId;
      if (input.heroMediaId !== undefined) data.heroMediaId = input.heroMediaId;
      if (input.position !== undefined) data.position = input.position;
      if (input.published !== undefined) data.published = input.published;
      if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle as Prisma.InputJsonValue;
      if (input.seoDescription !== undefined) {
        data.seoDescription = input.seoDescription as Prisma.InputJsonValue;
      }

      await tx.collection.update({ where: { id }, data });

      if (input.rules) {
        await tx.collectionRule.deleteMany({ where: { collectionId: id } });
        if (input.rules.length > 0) {
          await tx.collectionRule.createMany({
            data: input.rules.map((rule) => ({
              collectionId: id,
              field: rule.field,
              operator: rule.operator,
              value: rule.value,
            })),
          });
        }
      }
    });

    return this.get(id);
  }

  async addProducts(id: string, productIds: string[]): Promise<{ added: number }> {
    const collection = await this.requireManual(id);
    const last = await this.prisma.collectionProduct.findFirst({
      where: { collectionId: collection.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const result = await this.prisma.collectionProduct.createMany({
      data: productIds.map((productId, index) => ({
        collectionId: collection.id,
        productId,
        position: (last?.position ?? -1) + 1 + index,
      })),
      skipDuplicates: true,
    });

    return { added: result.count };
  }

  async removeProducts(id: string, productIds: string[]): Promise<{ removed: number }> {
    const collection = await this.requireManual(id);
    const result = await this.prisma.collectionProduct.deleteMany({
      where: { collectionId: collection.id, productId: { in: productIds } },
    });
    return { removed: result.count };
  }

  async reorderProducts(id: string, productIds: string[]): Promise<MerchandisingItem[]> {
    await this.requireManual(id);
    await this.prisma.$transaction(
      productIds.map((productId, position) =>
        this.prisma.collectionProduct.updateMany({
          where: { collectionId: id, productId },
          data: { position },
        }),
      ),
    );
    return this.members(id);
  }

  /**
   * Pins, hides and boosts. A smart collection gets a membership row created on demand,
   * because the override has to live somewhere and the rules do not carry it.
   */
  async merchandise(id: string, input: MerchandisingInput): Promise<MerchandisingItem[]> {
    const collection = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, isSmart: true },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        const data = {
          ...(item.pinned === undefined ? {} : { pinned: item.pinned }),
          ...(item.hidden === undefined ? {} : { hidden: item.hidden }),
          ...(item.boost === undefined ? {} : { boost: item.boost }),
          ...(item.position === undefined ? {} : { position: item.position }),
        };

        await tx.collectionProduct.upsert({
          where: { collectionId_productId: { collectionId: id, productId: item.productId } },
          update: data,
          create: {
            collectionId: id,
            productId: item.productId,
            pinned: item.pinned ?? false,
            hidden: item.hidden ?? false,
            boost: item.boost ?? 0,
            position: item.position ?? 0,
          },
        });
      }
    });

    return this.members(id);
  }

  async remove(id: string): Promise<void> {
    const collection = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { homeSections: true } } },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }
    if (collection._count.homeSections > 0) {
      throw new ConflictException({
        code: 'COLLECTION_IN_USE',
        message: 'The home page still shows this collection',
      });
    }

    await this.prisma.collection.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // --- internals ------------------------------------------------------------

  private async requireManual(id: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, isSmart: true },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }
    if (collection.isSmart) {
      throw new ConflictException({
        code: 'SMART_COLLECTION_MANUAL',
        message: CATALOG_ERRORS.SMART_COLLECTION_MANUAL,
      });
    }
    return collection;
  }

  private countMatches(
    rules: Array<{ field: string; operator: string; value: string }>,
    matchAll: boolean,
  ): Promise<number> {
    if (rules.length === 0) return Promise.resolve(0);
    return this.prisma.product.count({
      where: this.publishedAnd(rulesToFilter(rules, matchAll)),
    });
  }

  /**
   * A preview counts what a shopper would see, so it applies the same visibility gate
   * the storefront applies. Previewing against drafts would promise matches that never
   * appear.
   */
  private publishedAnd(filter: Prisma.ProductWhereInput): Prisma.ProductWhereInput {
    return {
      AND: [
        { status: 'ACTIVE', deletedAt: null, publishedAt: { not: null, lte: new Date() } },
        filter,
      ],
    };
  }

  private toPreviewRow(row: PreviewShape): ProductRow {
    return {
      id: row.id,
      name: (row.name ?? {}) as Translated,
      slug: row.slug,
      status: row.status as ProductRow['status'],
      brandName: row.brand?.name ?? null,
      categoryName: (row.category?.name ?? null) as Translated | null,
      thumbnailUrl: this.thumbnail(row),
      variantCount: 0,
      minPrice: row.minPrice.toString(),
      maxPrice: row.maxPrice.toString(),
      maxCompareAt: row.maxCompareAt?.toString() ?? null,
      totalStock: row.totalStock,
      lowStockThreshold: 0,
      ratingAverage: Number(row.ratingAverage),
      ratingCount: row.ratingCount,
      salesCount: row.salesCount,
      collectionCount: 0,
      mediaCount: row.media.length,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.createdAt.toISOString(),
    };
  }

  private toMerchandisingItem(
    row: PreviewShape,
    placement: { position: number; pinned: boolean; hidden: boolean; boost: number },
  ): MerchandisingItem {
    return {
      productId: row.id,
      name: (row.name ?? {}) as Translated,
      slug: row.slug,
      thumbnailUrl: this.thumbnail(row),
      status: row.status as MerchandisingItem['status'],
      minPrice: row.minPrice.toString(),
      totalStock: row.totalStock,
      salesCount: row.salesCount,
      ...placement,
    };
  }

  private thumbnail(row: PreviewShape): string | null {
    const media = row.media[0]?.media;
    if (!media) return null;
    const thumb = ((media.renditions as Rendition[] | null) ?? []).find(
      (rendition) => rendition.name === 'thumb' && rendition.format === 'webp',
    );
    return this.storage.publicUrl(thumb?.key ?? media.storageKey);
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.collection.findFirst({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: CATALOG_ERRORS.SLUG_TAKEN,
        details: { slug },
      });
    }
  }
}

const PREVIEW_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  minPrice: true,
  maxPrice: true,
  maxCompareAt: true,
  totalStock: true,
  ratingAverage: true,
  ratingCount: true,
  salesCount: true,
  publishedAt: true,
  createdAt: true,
  brand: { select: { name: true } },
  category: { select: { name: true } },
  media: {
    take: 1,
    orderBy: { position: 'asc' },
    select: { media: { select: { storageKey: true, renditions: true } } },
  },
} satisfies Prisma.ProductSelect;

type PreviewShape = Prisma.ProductGetPayload<{ select: typeof PREVIEW_SELECT }>;

/** Pinned products lead the grid; everything else keeps its arranged order. */
function byPinThenPosition(a: MerchandisingItem, b: MerchandisingItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.position - b.position;
}
