import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@jecks/db';
import type { CatalogQuery } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MATCHES_NOTHING, rulesToFilter } from './collection-rules.js';

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
    select: {
      media: {
        select: {
          storageKey: true,
          alt: true,
          width: true,
          height: true,
          renditions: true,
          blurhash: true,
        },
      },
    },
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

    // Merchandising only applies inside a collection, and only to the default order:
    // a shopper who has asked for "price, low to high" means it (F-AD-13).
    const placement =
      query.collection && query.sort === 'relevance'
        ? await this.collectionPlacement(query.collection, where)
        : null;

    const total = await this.prisma.product.count({ where });

    const items = placement
      ? await this.pageWithPlacement(query, where, placement, skip)
      : await this.prisma.product.findMany({
          where,
          select: cardSelect,
          orderBy: ORDER_BY[query.sort],
          skip,
          take: query.perPage,
        });

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

  /**
   * The pinned and boosted products of a collection, as two ordered id lists that
   * bracket the normal ordering — PRD F-AD-13.
   *
   * Prisma cannot order a product list by a column on the join row, and rewriting this
   * query in SQL would take the whole grid out of the query builder for the sake of a
   * handful of rows. Instead the override rows are read on their own — there are rarely
   * more than a dozen — and used as a lead and a tail around the ordinary page.
   */
  private async collectionPlacement(
    slug: string,
    where: Prisma.ProductWhereInput,
  ): Promise<{ lead: string[]; tail: string[] } | null> {
    const collection = await this.prisma.collection.findFirst({
      where: { slug, published: true, deletedAt: null },
      select: { id: true },
    });
    if (!collection) return null;

    const overrides = await this.prisma.collectionProduct.findMany({
      where: {
        collectionId: collection.id,
        hidden: false,
        OR: [{ pinned: true }, { boost: { not: 0 } }],
      },
      orderBy: [{ pinned: 'desc' }, { boost: 'desc' }, { position: 'asc' }],
      select: { productId: true, pinned: true, boost: true },
    });
    if (overrides.length === 0) return null;

    // An override on a product the filters exclude must not conjure it back into the
    // grid, so the list is intersected with what the query would have returned anyway.
    const visible = await this.prisma.product.findMany({
      where: { AND: [where, { id: { in: overrides.map((row) => row.productId) } }] },
      select: { id: true },
    });
    const allowed = new Set(visible.map((row) => row.id));

    const lead = overrides
      .filter((row) => allowed.has(row.productId) && (row.pinned || row.boost > 0))
      .map((row) => row.productId);
    const tail = overrides
      .filter((row) => allowed.has(row.productId) && !row.pinned && row.boost < 0)
      // Most demoted last.
      .sort((a, b) => a.boost - b.boost)
      .map((row) => row.productId);

    return lead.length + tail.length === 0 ? null : { lead, tail };
  }

  /** Slices one page out of the lead / middle / tail sequence. */
  private async pageWithPlacement(
    query: CatalogQuery,
    where: Prisma.ProductWhereInput,
    placement: { lead: string[]; tail: string[] },
    skip: number,
  ) {
    const { lead, tail } = placement;
    const bracketed = [...lead, ...tail];
    const middleWhere: Prisma.ProductWhereInput = {
      AND: [where, { id: { notIn: bracketed } }],
    };
    const middleTotal = await this.prisma.product.count({ where: middleWhere });

    const plan = planPlacementPage(lead, middleTotal, tail, skip, query.perPage);
    const ids = [...plan.leadIds];

    if (plan.middleTake > 0) {
      const rows = await this.prisma.product.findMany({
        where: middleWhere,
        select: { id: true },
        orderBy: ORDER_BY[query.sort],
        skip: plan.middleSkip,
        take: plan.middleTake,
      });
      ids.push(...rows.map((row) => row.id));
    }

    ids.push(...plan.tailIds);

    if (ids.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: cardSelect,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as typeof products;
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
              select: {
                id: true,
                kind: true,
                storageKey: true,
                posterKey: true,
                alt: true,
                width: true,
                height: true,
                renditions: true,
                blurhash: true,
              },
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
   * Expands a query through the synonym table — PRD F-AD-13.
   *
   * A two-way entry matches from either side, so one row covers "casquette" finding
   * "cap" and "cap" finding "casquette". The typed term stays first in the list, which
   * is what keeps an exact match ranked above a synonym match.
   */
  private async expandTerm(folded: string, original: string): Promise<string[]> {
    const entries = await this.prisma.searchSynonym.findMany({
      where: {
        active: true,
        OR: [{ term: folded }, { twoWay: true, synonyms: { has: folded } }],
      },
      select: { term: true, synonyms: true },
    });

    const expanded = new Set<string>([original]);
    for (const entry of entries) {
      if (entry.term !== folded) expanded.add(entry.term);
      for (const synonym of entry.synonyms) {
        if (synonym !== folded) expanded.add(synonym);
      }
    }

    // A pathological synonym list must not turn one search into forty tsquery scans.
    return [...expanded].slice(0, 8);
  }

  /**
   * Typo-tolerant search over the weighted tsvector, falling back to trigram similarity
   * when the stemmed query matches nothing — PRD Section 6.2.
   */
  async search(term: string, limit = 12) {
    const trimmed = term.trim();
    if (trimmed.length < 2) return { products: [], collections: [] };

    // `search_text` is the accent-folded, lower-cased name kept current by a trigger
    // (migration 20260909164000). Matching a column rather than an expression is what
    // lets the trigram index actually be used.
    const folded = trimmed.toLowerCase();

    // Synonyms the shop has taught the search, so "snapback" also finds "snap-back"
    // (PRD F-AD-13). The typed term always leads the list and so keeps its ranking.
    const terms = await this.expandTerm(folded, trimmed);

    // `plainto_tsquery` per term, ORed: one indexed lookup covers the whole expansion,
    // and none of the operator's text is interpolated into the query language.
    const tsQuery = Prisma.join(
      terms.map((value) => Prisma.sql`plainto_tsquery('fr_unaccent', ${value})`),
      ' || ',
    );

    // Stemmed match first: it is indexed, and it is what a correctly spelled query hits.
    let products = await this.prisma.$queryRaw<Array<{ id: string; slug: string; rank: number }>>`
      SELECT p.id, p.slug,
             ts_rank(p.search_vector, (${tsQuery})) AS rank
      FROM products p
      WHERE p.status = 'ACTIVE'
        AND p."deletedAt" IS NULL
        AND p.search_vector @@ (${tsQuery})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    // Only a misspelling falls through to trigrams. `word_similarity` compares the term
    // against the closest word in the text rather than the whole string, so a typo in
    // "trucker" still scores against that word and is not diluted by the rest of the
    // product name (PRD F-ST-25).
    if (products.length === 0) {
      products = await this.prisma.$queryRaw<Array<{ id: string; slug: string; rank: number }>>`
        SELECT p.id, p.slug,
               word_similarity(unaccent(${folded}), p.search_text) AS rank
        FROM products p
        WHERE p.status = 'ACTIVE'
          AND p."deletedAt" IS NULL
          AND word_similarity(unaccent(${folded}), p.search_text) > 0.35
        ORDER BY rank DESC
        LIMIT ${limit}
      `;
    }

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
        deletedAt: null,
        // Same folded column, so "ete" finds "Collection Été".
        OR: terms.map((value) => ({ searchText: { contains: value.toLowerCase() } })),
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
        if (collection.rules.length > 0) {
          and.push(rulesToFilter(collection.rules, collection.matchAll));
        }
        // The rules decide who belongs; merchandising can still take one out of this
        // grid without unpublishing it, and a smart collection stores that on the same
        // join row (F-AD-13).
        and.push({
          collections: { none: { collectionId: collection.id, hidden: true } },
        });
      } else if (collection) {
        and.push({
          collections: {
            some: {
              collectionId: collection.id,
              // A product hidden by merchandising stays published but leaves this grid.
              hidden: false,
            },
          },
        });
      } else {
        // Unknown slug must return nothing rather than the whole catalog.
        and.push(MATCHES_NOTHING);
      }
    }

    return { AND: and };
  }
}

/**
 * Slices one page out of the lead / middle / tail sequence a merchandised collection
 * produces — PRD F-AD-13.
 *
 * Pure, because this is the part that is easy to get wrong: the middle has to be offset
 * by however much of the lead has already been consumed, and the tail by the lead plus
 * the whole middle, or a product appears twice or vanishes between pages.
 */
export function planPlacementPage(
  lead: string[],
  middleTotal: number,
  tail: string[],
  skip: number,
  take: number,
): { leadIds: string[]; middleSkip: number; middleTake: number; tailIds: string[] } {
  const leadIds = lead.slice(skip, skip + take);

  const middleSkip = Math.max(skip - lead.length, 0);
  const remainingAfterLead = take - leadIds.length;
  const middleTake =
    remainingAfterLead > 0 && middleSkip < middleTotal
      ? Math.min(remainingAfterLead, middleTotal - middleSkip)
      : 0;

  const tailSkip = Math.max(skip - lead.length - middleTotal, 0);
  const tailTake = take - leadIds.length - middleTake;
  const tailIds = tailTake > 0 ? tail.slice(tailSkip, tailSkip + tailTake) : [];

  return { leadIds, middleSkip, middleTake, tailIds };
}
