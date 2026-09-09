import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@jecks/db';
import type { CatalogQuery } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Shape sent to product grids — deliberately narrow, PRD F-ST-23. */
const cardSelect = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  styleLabel: true,
  minPrice: true,
  maxPrice: true,
  maxCompareAt: true,
  totalStock: true,
  ratingAverage: true,
  ratingCount: true,
  salesCount: true,
  publishedAt: true,
  brand: { select: { slug: true, name: true } },
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
  media: {
    orderBy: { position: 'asc' },
    take: 2,
    select: { media: { select: { storageKey: true, alt: true, width: true, height: true } } },
  },
  options: {
    where: { kind: 'color' },
    take: 1,
    select: {
      values: {
        orderBy: { position: 'asc' },
        select: { id: true, name: true, swatchHex: true, media: { select: { storageKey: true } } },
      },
    },
  },
} satisfies Prisma.ProductSelect;

const ORDER_BY: Record<CatalogQuery['sort'], Prisma.ProductOrderByWithRelationInput[]> = {
  relevance: [{ salesCount: 'desc' }, { publishedAt: 'desc' }],
  best_selling: [{ salesCount: 'desc' }],
  newest: [{ publishedAt: 'desc' }],
  price_asc: [{ minPrice: 'asc' }],
  price_desc: [{ minPrice: 'desc' }],
  name_asc: [{ slug: 'asc' }],
  name_desc: [{ slug: 'desc' }],
  discount: [{ maxCompareAt: 'desc' }],
};

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Products carrying any of the given option values on an option of this kind. */
function optionValueFilter(kind: 'color' | 'size', values: string[]): Prisma.ProductWhereInput {
  return {
    options: {
      some: {
        kind,
        values: {
          some: { OR: values.map((value) => ({ name: { path: ['fr'], equals: value } })) },
        },
      },
    },
  };
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(query: CatalogQuery) {
    const where = await this.buildWhere(query);
    const skip = (query.page - 1) * query.perPage;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: cardSelect,
        orderBy: ORDER_BY[query.sort],
        skip,
        take: query.perPage,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(Math.ceil(total / query.perPage), 1),
      },
    };
  }

  async getProduct(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
      include: {
        brand: { select: { slug: true, name: true } },
        category: { select: { slug: true, name: true, path: true } },
        sizeGuide: { select: { id: true, name: true, body: true } },
        tags: { select: { tag: { select: { slug: true, name: true } } } },
        attributes: {
          select: { value: true, attribute: { select: { key: true, name: true, position: true } } },
        },
        media: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            media: {
              select: { id: true, kind: true, storageKey: true, posterKey: true, alt: true, width: true, height: true },
            },
          },
        },
        options: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            kind: true,
            values: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                name: true,
                swatchHex: true,
                media: { select: { storageKey: true } },
              },
            },
          },
        },
        variants: {
          where: { active: true, deletedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            sku: true,
            name: true,
            price: true,
            compareAtPrice: true,
            weightGrams: true,
            optionValues: { select: { optionValueId: true } },
            inventoryLevels: { select: { onHand: true, reserved: true } },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }

    // Availability is computed here so the storefront never sees raw stock numbers
    // beyond the "only N left" hint of PRD F-ST-32.
    const variants = product.variants.map((variant) => {
      const available = variant.inventoryLevels.reduce(
        (sum, level) => sum + Math.max(level.onHand - level.reserved, 0),
        0,
      );
      const { inventoryLevels: _levels, ...rest } = variant;
      return { ...rest, available, inStock: available > 0 };
    });

    return { ...product, variants };
  }

  async listCollections() {
    return this.prisma.collection.findMany({
      where: { published: true, deletedAt: null },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        isSmart: true,
        media: { select: { storageKey: true, alt: true } },
      },
    });
  }

  async getCollection(slug: string, query: CatalogQuery) {
    const collection = await this.prisma.collection.findFirst({
      where: { slug, published: true, deletedAt: null },
      include: { rules: true, hero: { select: { storageKey: true, alt: true } } },
    });
    if (!collection) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That collection does not exist' });
    }

    const products = await this.listProducts({ ...query, collection: slug });
    return { data: { collection, products: products.data }, meta: products.meta };
  }

  /**
   * Facet counts for the filter rail (PRD F-ST-21). Counted against the same filter set
   * so a facet never offers a combination that returns nothing.
   */
  async facets(query: CatalogQuery) {
    const where = await this.buildWhere(query);
    const [tags, categories, brands, priceRange] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        select: { slug: true, name: true, _count: { select: { products: true } } },
        orderBy: { slug: 'asc' },
      }),
      this.prisma.category.findMany({
        where: { published: true },
        select: { slug: true, name: true, _count: { select: { products: true } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.brand.findMany({
        select: { slug: true, name: true, _count: { select: { products: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.aggregate({ where, _min: { minPrice: true }, _max: { maxPrice: true } }),
    ]);

    return {
      tags: tags.filter((tag) => tag._count.products > 0),
      categories: categories.filter((category) => category._count.products > 0),
      brands: brands.filter((brand) => brand._count.products > 0),
      price: { min: priceRange._min.minPrice ?? 0n, max: priceRange._max.maxPrice ?? 0n },
    };
  }

  /**
   * Typo-tolerant search over the weighted tsvector, falling back to trigram similarity
   * when the stemmed query matches nothing — PRD Section 6.2.
   */
  async search(term: string, limit = 12) {
    const trimmed = term.trim();
    if (trimmed.length < 2) return { products: [], collections: [] };

    const products = await this.prisma.$queryRaw<Array<{ id: string; slug: string; rank: number }>>`
      SELECT p.id, p.slug,
             ts_rank(p.search_vector, plainto_tsquery('fr_unaccent', ${trimmed})) AS rank
      FROM products p
      WHERE p.status = 'ACTIVE'
        AND p."deletedAt" IS NULL
        AND (
          p.search_vector @@ plainto_tsquery('fr_unaccent', ${trimmed})
          OR similarity(p.name ->> 'fr', ${trimmed}) > 0.25
        )
      ORDER BY rank DESC, similarity(p.name ->> 'fr', ${trimmed}) DESC
      LIMIT ${limit}
    `;

    const ids = products.map((row) => row.id);
    const hydrated =
      ids.length === 0
        ? []
        : await this.prisma.product.findMany({ where: { id: { in: ids } }, select: cardSelect });
    // Keep the relevance order the query produced.
    const byId = new Map(hydrated.map((product) => [product.id, product]));

    const collections = await this.prisma.collection.findMany({
      where: {
        published: true,
        OR: [
          { slug: { contains: trimmed.toLowerCase() } },
          { name: { path: ['fr'], string_contains: trimmed } },
        ],
      },
      take: 4,
      select: { slug: true, name: true },
    });

    return {
      products: ids.map((id) => byId.get(id)).filter(Boolean),
      collections,
    };
  }

  /**
   * Translates the storefront query into a Prisma filter. Smart collections are
   * resolved to their rules here rather than materialized, so a rule change is live
   * immediately (PRD F-AD-11).
   */
  private async buildWhere(query: CatalogQuery): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [
      { status: 'ACTIVE', deletedAt: null, publishedAt: { not: null, lte: new Date() } },
    ];

    if (query.category) and.push({ category: { slug: query.category } });

    const brands = asArray(query.brand);
    if (brands.length > 0) and.push({ brand: { slug: { in: brands } } });

    const tags = asArray(query.tag);
    if (tags.length > 0) and.push({ tags: { some: { tag: { slug: { in: tags } } } } });

    // Prisma's JSON path filter has no `in`, so a multi-select becomes an OR of equals.
    const colors = asArray(query.color);
    if (colors.length > 0) and.push(optionValueFilter('color', colors));

    const sizes = asArray(query.size);
    if (sizes.length > 0) and.push(optionValueFilter('size', sizes));

    if (query.minPrice !== undefined) and.push({ minPrice: { gte: query.minPrice } });
    if (query.maxPrice !== undefined) and.push({ maxPrice: { lte: query.maxPrice } });
    if (query.inStock) and.push({ totalStock: { gt: 0 } });
    if (query.onSale) and.push({ maxCompareAt: { not: null } });

    if (query.collection) {
      const collection = await this.prisma.collection.findUnique({
        where: { slug: query.collection },
        include: { rules: true },
      });
      if (collection?.isSmart) {
        const ruleFilters = collection.rules.map((rule) => this.ruleToFilter(rule));
        if (ruleFilters.length > 0) {
          and.push(collection.matchAll ? { AND: ruleFilters } : { OR: ruleFilters });
        }
      } else if (collection) {
        and.push({ collections: { some: { collectionId: collection.id } } });
      } else {
        // Unknown slug must return nothing rather than the whole catalog.
        and.push({ id: '00000000-0000-0000-0000-000000000000' });
      }
    }

    return { AND: and };
  }

  private ruleToFilter(rule: {
    field: string;
    operator: string;
    value: string;
  }): Prisma.ProductWhereInput {
    const { field, operator, value } = rule;

    switch (field) {
      case 'TAG':
        return operator === 'NOT_EQUALS'
          ? { tags: { none: { tag: { slug: value } } } }
          : { tags: { some: { tag: { slug: value } } } };
      case 'CATEGORY':
        return { category: { slug: value } };
      case 'BRAND':
        return { brand: { slug: value } };
      case 'PRICE':
        return operator === 'LESS_THAN'
          ? { minPrice: { lt: BigInt(value) } }
          : { minPrice: { gt: BigInt(value) } };
      case 'DISCOUNT':
        // "any product currently marked down" — the Last Chance rule of F-ST-24.
        return { maxCompareAt: { not: null } };
      case 'STOCK':
        return operator === 'LESS_THAN'
          ? { totalStock: { lt: Number(value) } }
          : { totalStock: { gt: Number(value) } };
      case 'CREATED_AT': {
        // Relative windows like "-30d" keep a smart collection rolling.
        const match = /^-(\d+)d$/.exec(value);
        const since = match
          ? new Date(Date.now() - Number(match[1]) * 86_400_000)
          : new Date(value);
        return { publishedAt: { gte: since } };
      }
      case 'TITLE':
        return { name: { path: ['fr'], string_contains: value } };
      default:
        return {};
    }
  }
}
