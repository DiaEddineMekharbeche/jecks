import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import { sanitizeTranslatedRichText } from '../../../common/html/rich-text.js';
import {
  CATALOG_ERRORS,
  ProductStatus,
  marginPercent,
  money,
  slugify,
  type AdminListQuery,
  type AdminListResponse,
  type ProductBulkUpdateInput,
  type ProductDetail,
  type ProductDuplicateInput,
  type ProductInput,
  type ProductListFilters,
  type ProductMediaDto,
  type ProductOptionDto,
  type ProductPatchInput,
  type ProductRow,
  type Rendition,
  type Translated,
  type VariantDto,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { andWhere, listResponse, planExport, planList } from '../../../common/list/list.helper.js';
import type { ExportColumn } from '../../../common/list/export.service.js';
import { RollupsService } from './rollups.service.js';

/** Sort keys the products list accepts, mapped to Prisma paths. */
export const PRODUCT_SORTABLE = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  name: 'slug',
  status: 'status',
  price: 'minPrice',
  stock: 'totalStock',
  sales: 'salesCount',
  rating: 'ratingAverage',
} as const;

/**
 * The list row. Kept to the columns the table actually paints, plus one thumbnail —
 * a fifty-row page must not drag every variant and every image along with it.
 */
const PRODUCT_ROW_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  minPrice: true,
  maxPrice: true,
  maxCompareAt: true,
  totalStock: true,
  lowStockThreshold: true,
  ratingAverage: true,
  ratingCount: true,
  salesCount: true,
  publishedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  brand: { select: { name: true } },
  category: { select: { name: true } },
  media: {
    take: 1,
    orderBy: { position: 'asc' },
    select: { media: { select: { storageKey: true, renditions: true } } },
  },
  _count: { select: { variants: true, collections: true, media: true } },
} satisfies Prisma.ProductSelect;

/** Everything the seven tabs of the product editor need, in one round trip. */
const PRODUCT_DETAIL_INCLUDE = {
  tags: { select: { tagId: true } },
  collections: { select: { collectionId: true, collection: { select: { isSmart: true } } } },
  attributes: {
    select: { attributeId: true, value: true, attribute: { select: { key: true } } },
  },
  relatedFrom: {
    where: { kind: 'related' },
    orderBy: { position: 'asc' },
    select: { relatedProductId: true },
  },
  media: {
    orderBy: { position: 'asc' },
    select: {
      mediaId: true,
      position: true,
      media: {
        select: {
          kind: true,
          storageKey: true,
          posterKey: true,
          fileName: true,
          alt: true,
          renditions: true,
          blurhash: true,
          processedAt: true,
        },
      },
    },
  },
  options: {
    orderBy: { position: 'asc' },
    include: { values: { orderBy: { position: 'asc' } } },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: { position: 'asc' },
    include: {
      optionValues: { select: { optionValueId: true } },
      media: { orderBy: { position: 'asc' }, select: { mediaId: true, position: true } },
      inventoryLevels: { select: { onHand: true, reserved: true } },
      priceSchedules: { orderBy: { startsAt: 'desc' }, take: 10 },
    },
  },
  _count: { select: { stockNotifications: true } },
} satisfies Prisma.ProductInclude;

type ProductWithDetail = Prisma.ProductGetPayload<{ include: typeof PRODUCT_DETAIL_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rollups: RollupsService,
  ) {}

  // --- read -----------------------------------------------------------------

  async list(
    query: AdminListQuery,
    filters: ProductListFilters,
  ): Promise<AdminListResponse<ProductRow>> {
    const where = await this.buildWhere(query, filters);
    const plan = planList(query, PRODUCT_SORTABLE, 'updatedAt');

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, ...plan, select: PRODUCT_ROW_SELECT }),
      this.prisma.product.count({ where }),
    ]);

    return listResponse(
      query,
      rows.map((row) => this.toRow(row)),
      total,
    );
  }

  async listForExport(query: AdminListQuery, filters: ProductListFilters): Promise<ProductRow[]> {
    const where = await this.buildWhere(query, filters);
    const total = await this.prisma.product.count({ where });
    const { take } = planExport(total);

    const rows = await this.prisma.product.findMany({
      where,
      take,
      orderBy: planList(query, PRODUCT_SORTABLE, 'updatedAt').orderBy,
      select: PRODUCT_ROW_SELECT,
    });

    return rows.map((row) => this.toRow(row));
  }

  /** Counters for the status tabs, computed against every filter except status. */
  async statusCounts(filters: ProductListFilters): Promise<Record<string, number>> {
    const { status: _ignored, ...rest } = filters;
    const where = await this.buildWhere({ page: 1, pageSize: 1, order: 'desc' }, rest);

    const grouped = await this.prisma.product.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const counts: Record<string, number> = { ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return counts;
  }

  async get(id: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }
    return this.toDetail(product);
  }

  // --- write ----------------------------------------------------------------

  /**
   * Creates the product and its first variants in one transaction. The editor then
   * builds the option matrix on the Variants tab, which is why options are not part of
   * this payload: they need the product to exist before their values can be referenced.
   */
  async create(input: ProductInput): Promise<ProductDetail> {
    await this.assertSlugFree(input.slug);
    await this.assertSkusFree(input.variants.map((variant) => variant.sku));

    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name as Prisma.InputJsonValue,
          slug: input.slug,
          // Rendered as HTML on the product page, so it is cleaned before it is stored.
          description: (sanitizeTranslatedRichText(input.description) ?? undefined) as
            Prisma.InputJsonValue | undefined,
          shortDescription: (sanitizeTranslatedRichText(input.shortDescription) ?? undefined) as
            Prisma.InputJsonValue | undefined,
          status: input.status,
          brandId: input.brandId ?? null,
          categoryId: input.categoryId ?? null,
          sizeGuideId: input.sizeGuideId ?? null,
          styleLabel: input.styleLabel ?? null,
          seoTitle: (input.seoTitle ?? undefined) as Prisma.InputJsonValue | undefined,
          seoDescription: (input.seoDescription ?? undefined) as Prisma.InputJsonValue | undefined,
          publishedAt: input.publishedAt ?? null,
          lowStockThreshold: input.lowStockThreshold,
          allowBackorder: input.allowBackorder,
          trackInventory: input.trackInventory,
          shippingClass: input.shippingClass ?? null,
          variants: {
            create: input.variants.map((variant, index) => ({
              sku: variant.sku,
              barcode: variant.barcode ?? null,
              price: variant.price,
              compareAtPrice: variant.compareAtPrice ?? null,
              costPrice: variant.costPrice,
              weightGrams: variant.weightGrams,
              position: variant.position || index,
              active: variant.active,
            })),
          },
        },
        select: { id: true },
      });

      await this.writeRelations(tx, product.id, input);
      await this.rollups.refreshProduct(product.id, tx);
      return product.id;
    });

    return this.get(id);
  }

  /** Partial update: only the keys the editor actually sent are written. */
  async update(id: string, input: ProductPatchInput): Promise<ProductDetail> {
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }
    if (input.slug !== undefined) await this.assertSlugFree(input.slug, id);

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ProductUpdateInput = {};

      if (input.name !== undefined) data.name = input.name as Prisma.InputJsonValue;
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.description !== undefined) {
        data.description = sanitizeTranslatedRichText(input.description) as Prisma.InputJsonValue;
      }
      if (input.shortDescription !== undefined) {
        data.shortDescription = sanitizeTranslatedRichText(
          input.shortDescription,
        ) as Prisma.InputJsonValue;
      }
      if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle as Prisma.InputJsonValue;
      if (input.seoDescription !== undefined) {
        data.seoDescription = input.seoDescription as Prisma.InputJsonValue;
      }
      if (input.styleLabel !== undefined) data.styleLabel = input.styleLabel ?? null;
      if (input.shippingClass !== undefined) data.shippingClass = input.shippingClass ?? null;
      if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
      if (input.allowBackorder !== undefined) data.allowBackorder = input.allowBackorder;
      if (input.trackInventory !== undefined) data.trackInventory = input.trackInventory;
      if (input.publishedAt !== undefined) data.publishedAt = input.publishedAt ?? null;

      if (input.status !== undefined) {
        data.status = input.status;
        // Archiving stamps the date and un-archiving clears it, so the archive list can
        // sort by when things left the catalogue.
        data.archivedAt = input.status === ProductStatus.ARCHIVED ? new Date() : null;
      }

      if (input.brandId !== undefined) {
        data.brand = input.brandId ? { connect: { id: input.brandId } } : { disconnect: true };
      }
      if (input.categoryId !== undefined) {
        data.category = input.categoryId
          ? { connect: { id: input.categoryId } }
          : { disconnect: true };
      }
      if (input.sizeGuideId !== undefined) {
        data.sizeGuide = input.sizeGuideId
          ? { connect: { id: input.sizeGuideId } }
          : { disconnect: true };
      }

      await tx.product.update({ where: { id }, data });
      await this.writeRelations(tx, id, input);
    });

    // Publishing with no date recorded gets one here rather than inside the update
    // above, where Prisma cannot express "only if currently null".
    if (input.status === ProductStatus.ACTIVE) {
      await this.prisma.product.updateMany({
        where: { id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }

    return this.get(id);
  }

  /**
   * Copies a product, its options, variants, media and taxonomy under a new slug —
   * PRD F-AD-10. The copy always lands as a draft: an accidental duplicate going live
   * on the storefront is the failure mode worth designing out.
   */
  async duplicate(id: string, input: ProductDuplicateInput): Promise<ProductDetail> {
    const source = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!source) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }

    const sourceName = (source.name ?? {}) as Translated;
    const name = input.name ?? { ...sourceName, fr: `${sourceName.fr ?? ''} (copie)`.trim() };
    const slug = input.slug ?? (await this.nextFreeSlug(`${source.slug}-copie`));
    await this.assertSlugFree(slug);

    const newId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: name as Prisma.InputJsonValue,
          slug,
          description: (source.description ?? undefined) as Prisma.InputJsonValue | undefined,
          shortDescription: (source.shortDescription ?? undefined) as
            Prisma.InputJsonValue | undefined,
          status: ProductStatus.DRAFT,
          brandId: source.brandId,
          categoryId: source.categoryId,
          sizeGuideId: source.sizeGuideId,
          styleLabel: source.styleLabel,
          seoTitle: (source.seoTitle ?? undefined) as Prisma.InputJsonValue | undefined,
          seoDescription: (source.seoDescription ?? undefined) as Prisma.InputJsonValue | undefined,
          publishedAt: null,
          lowStockThreshold: source.lowStockThreshold,
          allowBackorder: source.allowBackorder,
          trackInventory: source.trackInventory,
          shippingClass: source.shippingClass,
          tags: { create: source.tags.map((tag) => ({ tagId: tag.tagId })) },
          attributes: {
            create: source.attributes.map((attribute) => ({
              attributeId: attribute.attributeId,
              value: attribute.value as Prisma.InputJsonValue,
            })),
          },
          ...(input.includeMedia
            ? {
                media: {
                  create: source.media.map((item) => ({
                    mediaId: item.mediaId,
                    position: item.position,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });

      if (input.includeVariants) {
        await this.copyOptionsAndVariants(tx, source, created.id, slug);
      } else {
        // A product cannot exist without a variant; give the copy a single placeholder
        // carrying the source's first price so the editor opens on something valid.
        const first = source.variants[0];
        await tx.variant.create({
          data: {
            productId: created.id,
            sku: await this.nextFreeSku(`${slug}-1`),
            price: first?.price ?? 0n,
            compareAtPrice: first?.compareAtPrice ?? null,
            costPrice: first?.costPrice ?? 0n,
            weightGrams: first?.weightGrams ?? 0,
          },
        });
      }

      await this.rollups.refreshProduct(created.id, tx);
      return created.id;
    });

    return this.get(newId);
  }

  /** Archive is reversible and never deletes: orders keep pointing at the product. */
  async setArchived(ids: string[], archived: boolean): Promise<{ updated: number }> {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: archived
        ? { status: ProductStatus.ARCHIVED, archivedAt: new Date() }
        : { status: ProductStatus.DRAFT, archivedAt: null },
    });
    return { updated: result.count };
  }

  async bulkUpdate(input: ProductBulkUpdateInput): Promise<{ updated: number }> {
    const existing = await this.prisma.product.findMany({
      where: { id: { in: input.ids }, deletedAt: null },
      select: { id: true },
    });
    const ids = existing.map((row) => row.id);
    if (ids.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'None of those products exist' });
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ProductUncheckedUpdateManyInput = {};
      if (input.status !== undefined) {
        data.status = input.status;
        data.archivedAt = input.status === ProductStatus.ARCHIVED ? new Date() : null;
      }
      if (input.categoryId !== undefined) data.categoryId = input.categoryId;
      if (input.brandId !== undefined) data.brandId = input.brandId;
      if (Object.keys(data).length > 0) {
        await tx.product.updateMany({ where: { id: { in: ids } }, data });
      }

      if (input.removeCollectionIds.length > 0) {
        await tx.collectionProduct.deleteMany({
          where: { productId: { in: ids }, collectionId: { in: input.removeCollectionIds } },
        });
      }
      if (input.addCollectionIds.length > 0) {
        await tx.collectionProduct.createMany({
          data: ids.flatMap((productId) =>
            input.addCollectionIds.map((collectionId) => ({ productId, collectionId })),
          ),
          skipDuplicates: true,
        });
      }

      if (input.removeTagIds.length > 0) {
        await tx.productTag.deleteMany({
          where: { productId: { in: ids }, tagId: { in: input.removeTagIds } },
        });
      }
      if (input.addTagIds.length > 0) {
        await tx.productTag.createMany({
          data: ids.flatMap((productId) => input.addTagIds.map((tagId) => ({ productId, tagId }))),
          skipDuplicates: true,
        });
      }

      if (input.price) {
        await this.applyPriceChange(tx, ids, input.price);
        await this.rollups.refreshProducts(ids, tx);
      }

      if (input.status === ProductStatus.ACTIVE) {
        await tx.product.updateMany({
          where: { id: { in: ids }, publishedAt: null },
          data: { publishedAt: new Date() },
        });
      }
    });

    return { updated: ids.length };
  }

  /**
   * Soft-deletes a product. Refused while an order references it, because a deleted
   * product would leave an order line pointing at nothing.
   */
  async remove(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, _count: { select: { variants: true } } },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }

    const orderedLines = await this.prisma.orderItem.count({
      where: { variant: { productId: id } },
    });
    if (orderedLines > 0) {
      throw new ConflictException({
        code: 'PRODUCT_IN_USE',
        message: 'This product appears on orders. Archive it instead of deleting it.',
        details: { orderLines: orderedLines },
      });
    }

    await this.prisma.$transaction([
      this.prisma.variant.updateMany({
        where: { productId: id },
        data: { deletedAt: new Date(), active: false },
      }),
      this.prisma.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: ProductStatus.ARCHIVED, archivedAt: new Date() },
      }),
    ]);
  }

  // --- internals ------------------------------------------------------------

  private async applyPriceChange(
    tx: Prisma.TransactionClient,
    productIds: string[],
    change: NonNullable<ProductBulkUpdateInput['price']>,
  ): Promise<void> {
    const variants = await tx.variant.findMany({
      where: { productId: { in: productIds }, deletedAt: null },
      select: { id: true, price: true, compareAtPrice: true, costPrice: true },
    });

    for (const variant of variants) {
      const current =
        change.target === 'price'
          ? variant.price
          : change.target === 'costPrice'
            ? variant.costPrice
            : variant.compareAtPrice;

      // A variant with no compare-at price is skipped rather than given one: a bulk
      // "+10 %" must not invent a fake original price on a product never discounted.
      if (current === null) continue;

      const next = nextAmount(current, change);
      await tx.variant.update({
        where: { id: variant.id },
        data: { [change.target]: next } as Prisma.VariantUpdateInput,
      });
    }
  }

  /** Collections, tags, attributes, media and related products — all set-replace. */
  private async writeRelations(
    tx: Prisma.TransactionClient,
    productId: string,
    input: ProductPatchInput | ProductInput,
  ): Promise<void> {
    if (input.collectionIds !== undefined) {
      await tx.collectionProduct.deleteMany({
        where: { productId, collection: { isSmart: false } },
      });
      if (input.collectionIds.length > 0) {
        // A smart collection is filled by its rules; adding a member by hand would be
        // silently overwritten on the next read, so those ids are dropped here.
        const manual = await tx.collection.findMany({
          where: { id: { in: input.collectionIds }, isSmart: false },
          select: { id: true },
        });
        await tx.collectionProduct.createMany({
          data: manual.map((collection, index) => ({
            productId,
            collectionId: collection.id,
            position: index,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (input.tagIds !== undefined) {
      await tx.productTag.deleteMany({ where: { productId } });
      if (input.tagIds.length > 0) {
        await tx.productTag.createMany({
          data: input.tagIds.map((tagId) => ({ productId, tagId })),
          skipDuplicates: true,
        });
      }
    }

    if (input.attributes !== undefined) {
      await tx.productAttribute.deleteMany({ where: { productId } });
      if (input.attributes.length > 0) {
        const keys = input.attributes.map((attribute) => attribute.key);
        const known = await tx.attribute.findMany({
          where: { key: { in: keys } },
          select: { id: true, key: true },
        });
        const byKey = new Map(known.map((attribute) => [attribute.key, attribute.id]));

        const missing = keys.filter((key) => !byKey.has(key));
        if (missing.length > 0) {
          throw new BadRequestException({
            code: 'UNKNOWN_ATTRIBUTE',
            message: `No attribute is defined for "${missing[0]}"`,
            details: { keys: missing },
          });
        }

        await tx.productAttribute.createMany({
          data: input.attributes.map((attribute) => ({
            productId,
            attributeId: byKey.get(attribute.key)!,
            value: attribute.value as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (input.mediaIds !== undefined) {
      await tx.productMedia.deleteMany({ where: { productId } });
      if (input.mediaIds.length > 0) {
        await tx.productMedia.createMany({
          // The array order is the gallery order — that is what drag-and-drop writes.
          data: input.mediaIds.map((mediaId, position) => ({ productId, mediaId, position })),
          skipDuplicates: true,
        });
      }
    }

    if (input.relatedProductIds !== undefined) {
      await tx.relatedProduct.deleteMany({ where: { productId, kind: 'related' } });
      const related = input.relatedProductIds.filter((target) => target !== productId);
      if (related.length > 0) {
        await tx.relatedProduct.createMany({
          data: related.map((relatedProductId, position) => ({
            productId,
            relatedProductId,
            kind: 'related',
            position,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  private async copyOptionsAndVariants(
    tx: Prisma.TransactionClient,
    source: ProductWithDetail,
    targetId: string,
    slugBase: string,
  ): Promise<void> {
    // Option values get fresh ids, so the variant links are rebuilt through a map from
    // the source value id to the copy's.
    const valueIdMap = new Map<string, string>();

    for (const option of source.options) {
      const created = await tx.productOption.create({
        data: {
          productId: targetId,
          name: option.name as Prisma.InputJsonValue,
          kind: option.kind,
          position: option.position,
          values: {
            create: option.values.map((value) => ({
              name: value.name as Prisma.InputJsonValue,
              swatchHex: value.swatchHex,
              mediaId: value.mediaId,
              position: value.position,
            })),
          },
        },
        include: { values: { orderBy: { position: 'asc' } } },
      });

      const sourceValues = [...option.values].sort((a, b) => a.position - b.position);
      created.values.forEach((value, index) => {
        const original = sourceValues[index];
        if (original) valueIdMap.set(original.id, value.id);
      });
    }

    let counter = 1;
    for (const variant of source.variants) {
      const copy = await tx.variant.create({
        data: {
          productId: targetId,
          sku: await this.nextFreeSku(`${slugBase}-${counter++}`, tx),
          barcode: null,
          name: variant.name,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          costPrice: variant.costPrice,
          weightGrams: variant.weightGrams,
          position: variant.position,
          active: variant.active,
        },
        select: { id: true },
      });

      const links = variant.optionValues
        .map((link) => valueIdMap.get(link.optionValueId))
        .filter((value): value is string => Boolean(value));

      if (links.length > 0) {
        await tx.variantOptionValue.createMany({
          data: links.map((optionValueId) => ({ variantId: copy.id, optionValueId })),
          skipDuplicates: true,
        });
      }

      if (variant.media.length > 0) {
        await tx.variantMedia.createMany({
          data: variant.media.map((item) => ({
            variantId: copy.id,
            mediaId: item.mediaId,
            position: item.position,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  private async buildWhere(
    query: AdminListQuery,
    filters: ProductListFilters,
  ): Promise<Prisma.ProductWhereInput> {
    return andWhere(
      { deletedAt: null },
      filters.status?.length ? { status: { in: filters.status as never } } : undefined,
      filters.categoryId?.length ? { categoryId: { in: filters.categoryId } } : undefined,
      filters.brandId?.length ? { brandId: { in: filters.brandId } } : undefined,
      filters.collectionId?.length
        ? { collections: { some: { collectionId: { in: filters.collectionId } } } }
        : undefined,
      filters.tagId?.length ? { tags: { some: { tagId: { in: filters.tagId } } } } : undefined,
      await this.stockFilter(filters.stock),
      moneyBound(filters.minPrice) !== null
        ? { minPrice: { gte: moneyBound(filters.minPrice)! } }
        : undefined,
      moneyBound(filters.maxPrice) !== null
        ? { maxPrice: { lte: moneyBound(filters.maxPrice)! } }
        : undefined,
      filters.hasMedia?.[0] === 'false' ? { media: { none: {} } } : undefined,
      filters.hasMedia?.[0] === 'true' ? { media: { some: {} } } : undefined,
      this.searchWhere(query.q),
    ) as Prisma.ProductWhereInput;
  }

  /**
   * Searches names, slugs and SKUs. `search_text` is the trigger-maintained, accent
   * folded copy of the name (D26), so a search for "casquette" finds "Casquette" and
   * an operator pasting a SKU from a packing slip finds its product.
   */
  private searchWhere(term: string | undefined): Prisma.ProductWhereInput | undefined {
    const value = term?.trim();
    if (!value) return undefined;
    return {
      OR: [
        { searchText: { contains: value.toLowerCase() } },
        { slug: { contains: value, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: value, mode: 'insensitive' } } } },
      ],
    };
  }

  /**
   * "Low" means at or under the product's own threshold but not yet zero. That compares
   * one column to another, which Prisma's filter language cannot express, so the
   * matching ids are resolved with one indexed query and fed back in as an `in` list.
   * A catalogue large enough for that list to hurt would need a generated column; this
   * one is measured in thousands of rows.
   */
  private async stockFilter(
    states: string[] | undefined,
  ): Promise<Prisma.ProductWhereInput | undefined> {
    if (!states?.length) return undefined;

    const clauses: Prisma.ProductWhereInput[] = [];
    if (states.includes('out')) clauses.push({ totalStock: { lte: 0 } });
    if (states.includes('in')) clauses.push({ totalStock: { gt: 0 } });
    if (states.includes('low')) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "products"
        WHERE "deletedAt" IS NULL
          AND "totalStock" > 0
          AND "totalStock" <= "lowStockThreshold"
      `;
      clauses.push({ id: { in: rows.map((row) => row.id) } });
    }

    if (clauses.length === 0) return undefined;
    return clauses.length === 1 ? clauses[0] : { OR: clauses };
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.product.findFirst({
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

  private async assertSkusFree(skus: string[], exceptIds: string[] = []): Promise<void> {
    const clash = await this.prisma.variant.findFirst({
      where: { sku: { in: skus }, id: { notIn: exceptIds } },
      select: { sku: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'SKU_TAKEN',
        message: CATALOG_ERRORS.SKU_TAKEN,
        details: { sku: clash.sku },
      });
    }
  }

  private async nextFreeSlug(base: string): Promise<string> {
    const root = slugify(base) || 'produit';
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
      const taken = await this.prisma.product.count({ where: { slug: candidate } });
      if (taken === 0) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async nextFreeSku(base: string, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma;
    const root =
      base
        .toUpperCase()
        .replace(/[^A-Z0-9._-]+/g, '-')
        .slice(0, 56) || 'SKU';
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
      const taken = await db.variant.count({ where: { sku: candidate } });
      if (taken === 0) return candidate;
    }
    return `${root}-${Date.now().toString(36).toUpperCase()}`;
  }

  private toRow(row: ProductRowShape): ProductRow {
    const first = row.media[0]?.media;
    return {
      id: row.id,
      name: (row.name ?? {}) as Translated,
      slug: row.slug,
      status: row.status as ProductRow['status'],
      brandName: row.brand?.name ?? null,
      categoryName: (row.category?.name ?? null) as Translated | null,
      thumbnailUrl: this.thumbnailUrl(first?.storageKey ?? null, first?.renditions ?? null),
      variantCount: row._count.variants,
      minPrice: row.minPrice.toString(),
      maxPrice: row.maxPrice.toString(),
      maxCompareAt: row.maxCompareAt?.toString() ?? null,
      totalStock: row.totalStock,
      lowStockThreshold: row.lowStockThreshold,
      ratingAverage: Number(row.ratingAverage),
      ratingCount: row.ratingCount,
      salesCount: row.salesCount,
      collectionCount: row._count.collections,
      mediaCount: row._count.media,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(product: ProductWithDetail): ProductDetail {
    const variants: VariantDto[] = product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      name: variant.name,
      price: variant.price.toString(),
      compareAtPrice: variant.compareAtPrice?.toString() ?? null,
      costPrice: variant.costPrice.toString(),
      weightGrams: variant.weightGrams,
      position: variant.position,
      active: variant.active,
      optionValueIds: variant.optionValues.map((link) => link.optionValueId),
      mediaIds: variant.media.map((item) => item.mediaId),
      stock: variant.inventoryLevels.reduce(
        (sum, level) => sum + Math.max(level.onHand - level.reserved, 0),
        0,
      ),
      marginPercent: marginPercent(money(variant.price), money(variant.costPrice)),
    }));

    const media: ProductMediaDto[] = product.media.map((item) => ({
      mediaId: item.mediaId,
      position: item.position,
      kind: item.media.kind,
      url: this.storage.publicUrl(item.media.storageKey) ?? '',
      posterUrl: this.storage.publicUrl(item.media.posterKey),
      fileName: item.media.fileName,
      alt: (item.media.alt ?? null) as Translated | null,
      renditions: (item.media.renditions as Rendition[] | null) ?? [],
      placeholderColor: item.media.blurhash,
      processedAt: item.media.processedAt?.toISOString() ?? null,
    }));

    const options: ProductOptionDto[] = product.options.map((option) => ({
      id: option.id,
      name: (option.name ?? {}) as Translated,
      kind: option.kind,
      position: option.position,
      values: option.values.map((value) => ({
        id: value.id,
        name: (value.name ?? {}) as Translated,
        swatchHex: value.swatchHex,
        mediaId: value.mediaId,
        position: value.position,
      })),
    }));

    return {
      id: product.id,
      name: (product.name ?? {}) as Translated,
      slug: product.slug,
      description: (product.description ?? null) as Translated | null,
      shortDescription: (product.shortDescription ?? null) as Translated | null,
      status: product.status as ProductDetail['status'],
      brandId: product.brandId,
      categoryId: product.categoryId,
      sizeGuideId: product.sizeGuideId,
      styleLabel: product.styleLabel,
      seoTitle: (product.seoTitle ?? null) as Translated | null,
      seoDescription: (product.seoDescription ?? null) as Translated | null,
      publishedAt: product.publishedAt?.toISOString() ?? null,
      archivedAt: product.archivedAt?.toISOString() ?? null,
      trackInventory: product.trackInventory,
      allowBackorder: product.allowBackorder,
      lowStockThreshold: product.lowStockThreshold,
      shippingClass: product.shippingClass,
      minPrice: product.minPrice.toString(),
      maxPrice: product.maxPrice.toString(),
      totalStock: product.totalStock,
      ratingAverage: Number(product.ratingAverage),
      ratingCount: product.ratingCount,
      salesCount: product.salesCount,
      collectionIds: product.collections
        .filter((link) => !link.collection.isSmart)
        .map((link) => link.collectionId),
      tagIds: product.tags.map((link) => link.tagId),
      relatedProductIds: product.relatedFrom.map((link) => link.relatedProductId),
      attributes: product.attributes.map((link) => ({
        key: link.attribute.key,
        value: (link.value ?? {}) as Translated,
      })),
      media,
      options,
      variants,
      priceSchedules: product.variants.flatMap((variant) =>
        variant.priceSchedules.map((schedule) => ({
          id: schedule.id,
          variantId: variant.id,
          sku: variant.sku,
          price: schedule.price.toString(),
          compareAtPrice: schedule.compareAtPrice?.toString() ?? null,
          startsAt: schedule.startsAt.toISOString(),
          endsAt: schedule.endsAt?.toISOString() ?? null,
          appliedAt: schedule.appliedAt?.toISOString() ?? null,
          revertedAt: schedule.revertedAt?.toISOString() ?? null,
        })),
      ),
      stockNotificationCount: product._count.stockNotifications,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /** Prefers the `thumb` rendition so a list of 50 rows is not 50 full-size images. */
  private thumbnailUrl(storageKey: string | null, renditions: unknown): string | null {
    const list = (renditions as Rendition[] | null) ?? [];
    const thumb = list.find(
      (rendition) => rendition.name === 'thumb' && rendition.format === 'webp',
    );
    return this.storage.publicUrl(thumb?.key ?? storageKey);
  }
}

/** Applies a bulk price operation, never letting the result go negative. */
export function nextAmount(
  current: bigint,
  change: NonNullable<ProductBulkUpdateInput['price']>,
): bigint {
  if (change.mode === 'set') return change.amountMinor ?? current;

  const delta =
    change.percent !== undefined
      ? // Rounds half away from zero on the minor unit, so a 10 % rise on 1 999 DA is
        // 2 198.90 DA rather than a value that drifts by a centime per operation.
        (current * BigInt(Math.round(change.percent * 100)) + 5000n) / 10000n
      : (change.amountMinor ?? 0n);

  const next = change.mode === 'increase' ? current + delta : current - delta;
  return next < 0n ? 0n : next;
}

type ProductRowShape = {
  id: string;
  name: unknown;
  slug: string;
  status: string;
  minPrice: bigint;
  maxPrice: bigint;
  maxCompareAt: bigint | null;
  totalStock: number;
  lowStockThreshold: number;
  ratingAverage: unknown;
  ratingCount: number;
  salesCount: number;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  brand: { name: string } | null;
  category: { name: unknown } | null;
  media: Array<{ media: { storageKey: string; renditions: unknown } }>;
  _count: { variants: number; collections: number; media: number };
};

/** Columns for the CSV and XLSX export; money is converted to dinars for the sheet. */
export const PRODUCT_EXPORT_COLUMNS: ExportColumn<ProductRow>[] = [
  { header: 'Nom', value: (row) => row.name.fr ?? '', width: 32 },
  { header: 'Slug', value: (row) => row.slug, width: 28 },
  { header: 'Statut', value: (row) => row.status },
  { header: 'Marque', value: (row) => row.brandName },
  { header: 'Catégorie', value: (row) => row.categoryName?.fr ?? '' },
  { header: 'Variantes', value: (row) => row.variantCount },
  { header: 'Prix min (DA)', value: (row) => toDinars(row.minPrice) },
  { header: 'Prix max (DA)', value: (row) => toDinars(row.maxPrice) },
  { header: 'Barré (DA)', value: (row) => (row.maxCompareAt ? toDinars(row.maxCompareAt) : '') },
  { header: 'Stock', value: (row) => row.totalStock },
  { header: 'Seuil', value: (row) => row.lowStockThreshold },
  { header: 'Note', value: (row) => row.ratingAverage },
  { header: 'Avis', value: (row) => row.ratingCount },
  { header: 'Ventes', value: (row) => row.salesCount },
  { header: 'Médias', value: (row) => row.mediaCount },
  { header: 'Publié le', value: (row) => (row.publishedAt ? new Date(row.publishedAt) : null) },
  { header: 'Créé le', value: (row) => new Date(row.createdAt) },
];

/** A filter value that is not a whole number of centimes is ignored, not fatal. */
function moneyBound(values: string[] | undefined): bigint | null {
  const raw = values?.[0]?.trim();
  return raw && /^d+$/.test(raw) ? BigInt(raw) : null;
}

function toDinars(minor: string): number {
  return Number(minor) / 100;
}
