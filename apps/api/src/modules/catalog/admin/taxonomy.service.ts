import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  CATALOG_ERRORS,
  type AttributeDto,
  type AttributeInput,
  type BrandDto,
  type BrandInput,
  type SizeGuideDto,
  type SizeGuideInput,
  type SynonymDto,
  type SynonymInput,
  type TagDto,
  type TagInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

/**
 * The small catalogue vocabularies — brands, tags, attributes, size guides and search
 * synonyms (PRD F-AD-11, F-AD-13).
 *
 * Each is a flat list of tens of rows that the product editor reads as a whole, so they
 * are returned unpaginated with their usage counts. The counts are what make deletion
 * safe to offer: an operator can see, before clicking, that a tag is on forty products.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // --- brands ---------------------------------------------------------------

  async listBrands(): Promise<BrandDto[]> {
    const rows = await this.prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        logo: { select: { storageKey: true } },
        _count: { select: { products: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: (row.description ?? null) as Translated | null,
      logoMediaId: row.logoMediaId,
      logoUrl: this.storage.publicUrl(row.logo?.storageKey),
      productCount: row._count.products,
    }));
  }

  async createBrand(input: BrandInput): Promise<BrandDto> {
    await this.assertFree('brand', input.slug);
    const created = await this.prisma.brand.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
        logoMediaId: input.logoMediaId ?? null,
      },
      select: { id: true },
    });
    return this.findBrand(created.id);
  }

  async updateBrand(id: string, input: BrandInput): Promise<BrandDto> {
    await this.assertFree('brand', input.slug, id);
    await this.prisma.brand.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
        logoMediaId: input.logoMediaId ?? null,
      },
    });
    return this.findBrand(id);
  }

  async removeBrand(id: string): Promise<void> {
    const used = await this.prisma.product.count({ where: { brandId: id, deletedAt: null } });
    if (used > 0) {
      throw new ConflictException({
        code: 'BRAND_IN_USE',
        message: `${used} products still carry this brand`,
        details: { productCount: used },
      });
    }
    await this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // --- tags -----------------------------------------------------------------

  async listTags(): Promise<TagDto[]> {
    const rows = await this.prisma.tag.findMany({
      orderBy: { slug: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      name: (row.name ?? {}) as Translated,
      slug: row.slug,
      productCount: row._count.products,
    }));
  }

  async createTag(input: TagInput): Promise<TagDto> {
    await this.assertFree('tag', input.slug);
    const created = await this.prisma.tag.create({
      data: { name: input.name as Prisma.InputJsonValue, slug: input.slug },
      include: { _count: { select: { products: true } } },
    });
    return {
      id: created.id,
      name: (created.name ?? {}) as Translated,
      slug: created.slug,
      productCount: created._count.products,
    };
  }

  async updateTag(id: string, input: TagInput): Promise<TagDto> {
    await this.assertFree('tag', input.slug, id);
    const updated = await this.prisma.tag.update({
      where: { id },
      data: { name: input.name as Prisma.InputJsonValue, slug: input.slug },
      include: { _count: { select: { products: true } } },
    });
    return {
      id: updated.id,
      name: (updated.name ?? {}) as Translated,
      slug: updated.slug,
      productCount: updated._count.products,
    };
  }

  /** A tag is removed from its products rather than blocking: it carries no data. */
  async removeTag(id: string): Promise<void> {
    const exists = await this.prisma.tag.count({ where: { id } });
    if (exists === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That tag does not exist' });
    }
    await this.prisma.$transaction([
      this.prisma.productTag.deleteMany({ where: { tagId: id } }),
      this.prisma.tag.delete({ where: { id } }),
    ]);
  }

  // --- attributes -----------------------------------------------------------

  async listAttributes(): Promise<AttributeDto[]> {
    const rows = await this.prisma.attribute.findMany({
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
      include: { _count: { select: { products: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: (row.name ?? {}) as Translated,
      kind: row.kind,
      options: (row.options ?? null) as Translated[] | null,
      filterable: row.filterable,
      position: row.position,
      productCount: row._count.products,
    }));
  }

  async createAttribute(input: AttributeInput): Promise<AttributeDto> {
    const clash = await this.prisma.attribute.count({ where: { key: input.key } });
    if (clash > 0) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: `An attribute with the key "${input.key}" already exists`,
      });
    }

    const created = await this.prisma.attribute.create({
      data: this.attributeData(input),
      include: { _count: { select: { products: true } } },
    });
    return this.toAttribute(created);
  }

  /**
   * The key is immutable once set. Products reference an attribute by id, but imports
   * and the storefront filter rail address it by key, so renaming one would silently
   * break every saved import template.
   */
  async updateAttribute(id: string, input: AttributeInput): Promise<AttributeDto> {
    const current = await this.prisma.attribute.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That attribute does not exist' });
    }
    if (current.key !== input.key) {
      throw new ConflictException({
        code: 'KEY_IMMUTABLE',
        message: 'An attribute key cannot be changed. Create a new attribute instead.',
      });
    }

    const updated = await this.prisma.attribute.update({
      where: { id },
      data: this.attributeData(input),
      include: { _count: { select: { products: true } } },
    });
    return this.toAttribute(updated);
  }

  async removeAttribute(id: string): Promise<void> {
    const used = await this.prisma.productAttribute.count({ where: { attributeId: id } });
    if (used > 0) {
      throw new ConflictException({
        code: 'ATTRIBUTE_IN_USE',
        message: `${used} products still set this attribute`,
        details: { productCount: used },
      });
    }
    await this.prisma.attribute.delete({ where: { id } });
  }

  // --- size guides ----------------------------------------------------------

  async listSizeGuides(): Promise<SizeGuideDto[]> {
    const rows = await this.prisma.sizeGuide.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        category: { select: { name: true } },
        _count: { select: { products: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: (row.name ?? {}) as Translated,
      body: (row.body ?? {}) as Translated,
      categoryId: row.categoryId,
      categoryName: (row.category?.name ?? null) as Translated | null,
      productCount: row._count.products,
    }));
  }

  async createSizeGuide(input: SizeGuideInput): Promise<SizeGuideDto> {
    const created = await this.prisma.sizeGuide.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        body: input.body as Prisma.InputJsonValue,
        categoryId: input.categoryId ?? null,
      },
      select: { id: true },
    });
    return this.findSizeGuide(created.id);
  }

  async updateSizeGuide(id: string, input: SizeGuideInput): Promise<SizeGuideDto> {
    await this.prisma.sizeGuide.update({
      where: { id },
      data: {
        name: input.name as Prisma.InputJsonValue,
        body: input.body as Prisma.InputJsonValue,
        categoryId: input.categoryId ?? null,
      },
    });
    return this.findSizeGuide(id);
  }

  async removeSizeGuide(id: string): Promise<void> {
    const used = await this.prisma.product.count({ where: { sizeGuideId: id, deletedAt: null } });
    if (used > 0) {
      throw new ConflictException({
        code: 'SIZE_GUIDE_IN_USE',
        message: `${used} products still link to this size guide`,
        details: { productCount: used },
      });
    }
    await this.prisma.sizeGuide.delete({ where: { id } });
  }

  // --- search synonyms ------------------------------------------------------

  async listSynonyms(): Promise<SynonymDto[]> {
    const rows = await this.prisma.searchSynonym.findMany({ orderBy: { term: 'asc' } });
    return rows.map(toSynonym);
  }

  async createSynonym(input: SynonymInput): Promise<SynonymDto> {
    const clash = await this.prisma.searchSynonym.count({ where: { term: input.term } });
    if (clash > 0) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: `"${input.term}" already has a synonym entry`,
      });
    }
    const created = await this.prisma.searchSynonym.create({
      data: {
        term: input.term,
        // A term listed as its own synonym would expand into a loop for no gain.
        synonyms: input.synonyms.filter((synonym) => synonym !== input.term),
        twoWay: input.twoWay,
        active: input.active,
      },
    });
    return toSynonym(created);
  }

  async updateSynonym(id: string, input: SynonymInput): Promise<SynonymDto> {
    const clash = await this.prisma.searchSynonym.findFirst({
      where: { term: input.term, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: `"${input.term}" already has a synonym entry`,
      });
    }
    const updated = await this.prisma.searchSynonym.update({
      where: { id },
      data: {
        term: input.term,
        synonyms: input.synonyms.filter((synonym) => synonym !== input.term),
        twoWay: input.twoWay,
        active: input.active,
      },
    });
    return toSynonym(updated);
  }

  async removeSynonym(id: string): Promise<void> {
    await this.prisma.searchSynonym.delete({ where: { id } });
  }

  // --- internals ------------------------------------------------------------

  private attributeData(input: AttributeInput): Prisma.AttributeUncheckedCreateInput {
    return {
      key: input.key,
      name: input.name as Prisma.InputJsonValue,
      kind: input.kind,
      options: (input.options ?? undefined) as Prisma.InputJsonValue | undefined,
      filterable: input.filterable,
      position: input.position,
    };
  }

  private toAttribute(row: {
    id: string;
    key: string;
    name: unknown;
    kind: string;
    options: unknown;
    filterable: boolean;
    position: number;
    _count: { products: number };
  }): AttributeDto {
    return {
      id: row.id,
      key: row.key,
      name: (row.name ?? {}) as Translated,
      kind: row.kind,
      options: (row.options ?? null) as Translated[] | null,
      filterable: row.filterable,
      position: row.position,
      productCount: row._count.products,
    };
  }

  private async findBrand(id: string): Promise<BrandDto> {
    const brands = await this.listBrands();
    const brand = brands.find((candidate) => candidate.id === id);
    if (!brand) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That brand does not exist' });
    }
    return brand;
  }

  private async findSizeGuide(id: string): Promise<SizeGuideDto> {
    const guides = await this.listSizeGuides();
    const guide = guides.find((candidate) => candidate.id === id);
    if (!guide) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That size guide does not exist' });
    }
    return guide;
  }

  private async assertFree(
    entity: 'brand' | 'tag',
    slug: string,
    exceptId?: string,
  ): Promise<void> {
    const where = { slug, ...(exceptId ? { id: { not: exceptId } } : {}) };
    const clash =
      entity === 'brand'
        ? await this.prisma.brand.count({ where })
        : await this.prisma.tag.count({ where });

    if (clash > 0) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: CATALOG_ERRORS.SLUG_TAKEN,
        details: { slug },
      });
    }
  }
}

function toSynonym(row: {
  id: string;
  term: string;
  synonyms: string[];
  twoWay: boolean;
  active: boolean;
}): SynonymDto {
  return {
    id: row.id,
    term: row.term,
    synonyms: row.synonyms,
    twoWay: row.twoWay,
    active: row.active,
  };
}
