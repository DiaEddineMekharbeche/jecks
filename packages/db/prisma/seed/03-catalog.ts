import type { PrismaClient } from '@prisma/client';
import { COLORS, COLOR_AR, PRODUCTS, SIZE_AR, type ProductSeed } from './data/products.js';
import { dzd, log, makeRng, slugify, tr } from './util.js';
import { writePlaceholderImage } from './placeholder-media.js';

const CATEGORIES: Array<{ slug: string; fr: string; ar: string; en: string; parent?: string }> = [
  { slug: 'casquettes', fr: 'Casquettes', ar: 'قبعات', en: 'Caps' },
  { slug: 'trucker', fr: 'Trucker', ar: 'تراكر', en: 'Trucker', parent: 'casquettes' },
  { slug: 'snapback', fr: 'Snapback', ar: 'سناباك', en: 'Snapback', parent: 'casquettes' },
  { slug: 'fitted', fr: 'Fitted', ar: 'فيتد', en: 'Fitted', parent: 'casquettes' },
  { slug: 'dad-cap', fr: 'Dad caps', ar: 'داد كاب', en: 'Dad caps', parent: 'casquettes' },
  { slug: 'five-panel', fr: '5-panel', ar: 'خمس لوحات', en: '5-panel', parent: 'casquettes' },
  { slug: 'chapeaux', fr: 'Chapeaux', ar: 'قبعات عريضة', en: 'Hats' },
  { slug: 'bucket', fr: 'Bobs', ar: 'قبعات دلو', en: 'Bucket hats', parent: 'chapeaux' },
  { slug: 'bonnets', fr: 'Bonnets', ar: 'قبعات صوفية', en: 'Beanies' },
  { slug: 'beanie', fr: 'Beanies', ar: 'بيني', en: 'Beanies', parent: 'bonnets' },
  { slug: 'femmes', fr: 'Femmes', ar: 'نساء', en: 'Women' },
  { slug: 'enfants', fr: 'Enfants', ar: 'أطفال', en: 'Kids' },
];

const BRANDS = [
  { slug: 'jecks', name: "Jeck's" },
  { slug: 'jecks-heritage', name: "Jeck's Heritage" },
  { slug: 'jecks-sport', name: "Jeck's Sport" },
];

const ATTRIBUTES = [
  { key: 'material', fr: 'Matière', ar: 'المادة', en: 'Material' },
  { key: 'closure', fr: 'Fermeture', ar: 'الإغلاق', en: 'Closure' },
  { key: 'crown', fr: 'Couronne', ar: 'التاج', en: 'Crown' },
  { key: 'brim', fr: 'Visière', ar: 'الحافة', en: 'Brim' },
  { key: 'fit', fr: 'Coupe', ar: 'المقاس', en: 'Fit' },
  { key: 'care', fr: 'Entretien', ar: 'العناية', en: 'Care' },
  { key: 'origin', fr: 'Origine', ar: 'المنشأ', en: 'Origin' },
];

const TAG_LABELS: Record<string, { fr: string; ar: string; en: string }> = {
  nouveaute: { fr: 'Nouveauté', ar: 'جديد', en: 'New' },
  'best-seller': { fr: 'Best-seller', ar: 'الأكثر مبيعا', en: 'Best seller' },
  promo: { fr: 'Promo', ar: 'تخفيض', en: 'Sale' },
  heritage: { fr: 'Heritage', ar: 'تراث', en: 'Heritage' },
  'edition-limitee': { fr: 'Édition limitée', ar: 'إصدار محدود', en: 'Limited edition' },
  ete: { fr: 'Été', ar: 'صيف', en: 'Summer' },
  hiver: { fr: 'Hiver', ar: 'شتاء', en: 'Winter' },
  sport: { fr: 'Sport', ar: 'رياضة', en: 'Sport' },
  outdoor: { fr: 'Outdoor', ar: 'الهواء الطلق', en: 'Outdoor' },
  femme: { fr: 'Femme', ar: 'نساء', en: 'Women' },
  enfant: { fr: 'Enfant', ar: 'أطفال', en: 'Kids' },
  clearance: { fr: 'Déstockage', ar: 'تصفية', en: 'Clearance' },
};

export interface CatalogResult {
  variantIds: string[];
  productIds: string[];
  locationIds: string[];
}

export async function seedCatalog(prisma: PrismaClient): Promise<CatalogResult> {
  const rng = makeRng(20260909);

  // --- brands ----------------------------------------------------------------
  const brandIds = new Map<string, string>();
  for (const brand of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { slug: brand.slug },
      create: { slug: brand.slug, name: brand.name },
      update: { name: brand.name },
    });
    brandIds.set(brand.slug, row.id);
  }
  log('brands', BRANDS.length);

  // --- categories ------------------------------------------------------------
  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const parentId = category.parent ? categoryIds.get(category.parent) : undefined;
    const parentPath = category.parent ? `/${category.parent}` : '';
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        name: tr(category.fr, category.ar, category.en),
        parentId,
        path: `${parentPath}/${category.slug}/`,
        depth: category.parent ? 1 : 0,
        position: index,
      },
      update: { name: tr(category.fr, category.ar, category.en), parentId },
    });
    categoryIds.set(category.slug, row.id);
  }
  log('categories', CATEGORIES.length);

  // --- tags ------------------------------------------------------------------
  const tagIds = new Map<string, string>();
  for (const [slug, label] of Object.entries(TAG_LABELS)) {
    const row = await prisma.tag.upsert({
      where: { slug },
      create: { slug, name: tr(label.fr, label.ar, label.en) },
      update: { name: tr(label.fr, label.ar, label.en) },
    });
    tagIds.set(slug, row.id);
  }
  log('tags', tagIds.size);

  // --- attributes ------------------------------------------------------------
  const attributeIds = new Map<string, string>();
  for (const [index, attribute] of ATTRIBUTES.entries()) {
    const row = await prisma.attribute.upsert({
      where: { key: attribute.key },
      create: {
        key: attribute.key,
        name: tr(attribute.fr, attribute.ar, attribute.en),
        position: index,
      },
      update: { name: tr(attribute.fr, attribute.ar, attribute.en) },
    });
    attributeIds.set(attribute.key, row.id);
  }
  log('attributes', ATTRIBUTES.length);

  // --- size guides -----------------------------------------------------------
  const sizeGuideBody = tr(
    '<table><thead><tr><th>Taille</th><th>Tour de tête</th></tr></thead><tbody><tr><td>S</td><td>54-56 cm</td></tr><tr><td>M</td><td>56-58 cm</td></tr><tr><td>L</td><td>58-60 cm</td></tr><tr><td>Taille unique</td><td>55-60 cm, réglable</td></tr></tbody></table>',
    '<table><thead><tr><th>المقاس</th><th>محيط الرأس</th></tr></thead><tbody><tr><td>S</td><td>54-56 سم</td></tr><tr><td>M</td><td>56-58 سم</td></tr><tr><td>L</td><td>58-60 سم</td></tr></tbody></table>',
    '<table><thead><tr><th>Size</th><th>Head circumference</th></tr></thead><tbody><tr><td>S</td><td>54-56 cm</td></tr><tr><td>M</td><td>56-58 cm</td></tr><tr><td>L</td><td>58-60 cm</td></tr><tr><td>One size</td><td>55-60 cm, adjustable</td></tr></tbody></table>',
  );
  const existingGuide = await prisma.sizeGuide.findFirst({ where: { categoryId: categoryIds.get('casquettes') } });
  const sizeGuide =
    existingGuide ??
    (await prisma.sizeGuide.create({
      data: {
        name: tr('Guide des tailles casquettes', 'دليل المقاسات', 'Cap size guide'),
        body: sizeGuideBody,
        categoryId: categoryIds.get('casquettes'),
      },
    }));

  // --- locations for inventory ----------------------------------------------
  const locations = await prisma.location.findMany({ orderBy: { code: 'asc' } });
  const mainLocation = locations.find((l) => l.isDefault) ?? locations[0];
  if (!mainLocation) throw new Error('Seed the geo module before the catalog: no location exists');

  // --- products --------------------------------------------------------------
  const variantIds: string[] = [];
  const productIds: string[] = [];

  for (const [index, seed] of PRODUCTS.entries()) {
    const { productId, createdVariantIds } = await seedProduct({
      prisma,
      seed,
      index,
      rng,
      brandIds,
      categoryIds,
      tagIds,
      attributeIds,
      sizeGuideId: sizeGuide.id,
      locations,
      mainLocationId: mainLocation.id,
    });
    productIds.push(productId);
    variantIds.push(...createdVariantIds);
  }
  log('products', PRODUCTS.length);
  log('variants', variantIds.length);

  // --- collections -----------------------------------------------------------
  await seedCollections(prisma, productIds);

  return { variantIds, productIds, locationIds: locations.map((l) => l.id) };
}

interface SeedProductArgs {
  prisma: PrismaClient;
  seed: ProductSeed;
  index: number;
  rng: () => number;
  brandIds: Map<string, string>;
  categoryIds: Map<string, string>;
  tagIds: Map<string, string>;
  attributeIds: Map<string, string>;
  sizeGuideId: string;
  locations: Array<{ id: string; isDefault: boolean }>;
  mainLocationId: string;
}

async function seedProduct(args: SeedProductArgs): Promise<{ productId: string; createdVariantIds: string[] }> {
  const { prisma, seed, index, rng, brandIds, categoryIds, tagIds, attributeIds, sizeGuideId, locations } = args;

  const prices = seed.colors.length * seed.sizes.length;
  const publishedAt = new Date(Date.now() - (PRODUCTS.length - index) * 36 * 3600 * 1000);

  const product = await prisma.product.upsert({
    where: { slug: seed.slug },
    create: {
      slug: seed.slug,
      name: tr(seed.fr, seed.ar, seed.en),
      shortDescription: tr(seed.descriptionFr.split('.')[0] + '.', undefined, undefined),
      description: tr(seed.descriptionFr, undefined, undefined),
      status: 'ACTIVE',
      styleLabel: seed.style,
      brandId: brandIds.get(seed.brand),
      categoryId: categoryIds.get(seed.category),
      sizeGuideId,
      publishedAt,
      minPrice: dzd(seed.price),
      maxPrice: dzd(seed.price),
      maxCompareAt: seed.compareAt ? dzd(seed.compareAt) : null,
      seoTitle: tr(`${seed.fr} — Jeck's`, undefined, `${seed.en} — Jeck's`),
      seoDescription: tr(seed.descriptionFr.slice(0, 155)),
    },
    update: {
      name: tr(seed.fr, seed.ar, seed.en),
      minPrice: dzd(seed.price),
      maxPrice: dzd(seed.price),
      maxCompareAt: seed.compareAt ? dzd(seed.compareAt) : null,
    },
  });

  // tags
  for (const tag of seed.tags) {
    const tagId = tagIds.get(tag);
    if (!tagId) continue;
    await prisma.productTag.upsert({
      where: { productId_tagId: { productId: product.id, tagId } },
      create: { productId: product.id, tagId },
      update: {},
    });
  }

  // attributes
  const attributeValues: Record<string, string> = {
    material: seed.material,
    closure: seed.closure,
    crown: seed.crown,
    brim: seed.brim,
    fit: seed.fit,
    care: 'Nettoyage à la main, séchage à plat',
    origin: 'Conçu à Alger',
  };
  for (const [key, value] of Object.entries(attributeValues)) {
    const attributeId = attributeIds.get(key);
    if (!attributeId) continue;
    await prisma.productAttribute.upsert({
      where: { productId_attributeId: { productId: product.id, attributeId } },
      create: { productId: product.id, attributeId, value: tr(value) },
      update: { value: tr(value) },
    });
  }

  // options: Couleur x Taille
  const existingOptions = await prisma.productOption.findMany({ where: { productId: product.id } });
  if (existingOptions.length > 0) {
    const existingVariants = await prisma.variant.findMany({ where: { productId: product.id }, select: { id: true } });
    return { productId: product.id, createdVariantIds: existingVariants.map((v) => v.id) };
  }

  const colorOption = await prisma.productOption.create({
    data: {
      productId: product.id,
      name: tr('Couleur', 'اللون', 'Colour'),
      kind: 'color',
      position: 0,
    },
  });
  const colorValues = new Map<string, string>();
  for (const [i, color] of seed.colors.entries()) {
    const value = await prisma.productOptionValue.create({
      data: {
        optionId: colorOption.id,
        name: tr(color, COLOR_AR[color], color),
        swatchHex: COLORS[color] ?? '#888888',
        position: i,
      },
    });
    colorValues.set(color, value.id);
  }

  const sizeOption = await prisma.productOption.create({
    data: {
      productId: product.id,
      name: tr('Taille', 'المقاس', 'Size'),
      kind: 'size',
      position: 1,
    },
  });
  const sizeValues = new Map<string, string>();
  for (const [i, size] of seed.sizes.entries()) {
    const value = await prisma.productOptionValue.create({
      data: {
        optionId: sizeOption.id,
        name: tr(size, SIZE_AR[size], size),
        position: i,
      },
    });
    sizeValues.set(size, value.id);
  }

  // media: one placeholder per colourway, first is the product cover
  const mediaByColor = new Map<string, string>();
  for (const [i, color] of seed.colors.entries()) {
    const key = `demo/products/${seed.slug}-${slugify(color)}.svg`;
    await writePlaceholderImage(key, { title: seed.fr, subtitle: color, hex: COLORS[color] ?? '#888888' });
    const media = await prisma.media.create({
      data: {
        kind: 'IMAGE',
        storageKey: key,
        fileName: `${seed.slug}-${slugify(color)}.svg`,
        mimeType: 'image/svg+xml',
        sizeBytes: 2048,
        width: 1200,
        height: 1500,
        alt: tr(`${seed.fr} coloris ${color}`, undefined, `${seed.en} in ${color}`),
      },
    });
    mediaByColor.set(color, media.id);
    await prisma.productMedia.create({
      data: { productId: product.id, mediaId: media.id, position: i },
    });
    const optionValueId = colorValues.get(color);
    if (optionValueId) {
      await prisma.productOptionValue.update({
        where: { id: optionValueId },
        data: { mediaId: media.id },
      });
    }
  }

  // variants: colour x size
  const createdVariantIds: string[] = [];
  let position = 0;
  for (const color of seed.colors) {
    for (const size of seed.sizes) {
      const skuColor = slugify(color).slice(0, 3).toUpperCase();
      const skuSize = slugify(size).replace(/-/g, '').slice(0, 3).toUpperCase();
      const sku = `${seed.slug.toUpperCase().replace(/-/g, '').slice(0, 10)}-${skuColor}-${skuSize}`;

      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          sku,
          name: `${color} / ${size}`,
          price: dzd(seed.price),
          compareAtPrice: seed.compareAt ? dzd(seed.compareAt) : null,
          costPrice: dzd(seed.cost),
          weightGrams: seed.category === 'beanie' ? 120 : 180,
          position: position++,
          optionValues: {
            create: [
              { optionValueId: colorValues.get(color) as string },
              { optionValueId: sizeValues.get(size) as string },
            ],
          },
        },
      });
      createdVariantIds.push(variant.id);

      const mediaId = mediaByColor.get(color);
      if (mediaId) {
        await prisma.variantMedia.create({ data: { variantId: variant.id, mediaId } });
      }

      // Inventory: healthy stock in the main warehouse, thinner in Oran.
      // A few variants are left at zero so the low-stock widgets have something to show.
      for (const [i, location] of locations.entries()) {
        const base = location.isDefault ? 24 : 8;
        const roll = rng();
        const onHand = roll < 0.06 ? 0 : roll < 0.16 ? Math.floor(rng() * 4) + 1 : Math.floor(rng() * base) + 4;
        await prisma.inventoryLevel.create({
          data: { variantId: variant.id, locationId: location.id, onHand: i === 0 ? onHand : Math.floor(onHand / 3) },
        });
      }
    }
  }

  // Refresh the denormalized stock total the storefront reads.
  const totals = await prisma.inventoryLevel.aggregate({
    where: { variant: { productId: product.id } },
    _sum: { onHand: true },
  });
  await prisma.product.update({
    where: { id: product.id },
    data: {
      totalStock: totals._sum.onHand ?? 0,
      salesCount: Math.floor(rng() * 180),
      viewsCount: Math.floor(rng() * 4000) + prices * 20,
    },
  });

  return { productId: product.id, createdVariantIds };
}

async function seedCollections(prisma: PrismaClient, productIds: string[]): Promise<void> {
  // Smart collections — rules are evaluated by the API, so the rows only carry intent.
  const smart = [
    {
      slug: 'nouveautes',
      fr: 'Nouveautés',
      ar: 'الجديد',
      en: 'New arrivals',
      rules: [{ field: 'CREATED_AT' as const, operator: 'GREATER_THAN' as const, value: '-30d' }],
    },
    {
      slug: 'meilleures-ventes',
      fr: 'Meilleures ventes',
      ar: 'الأكثر مبيعا',
      en: 'Best sellers',
      rules: [{ field: 'TAG' as const, operator: 'EQUALS' as const, value: 'best-seller' }],
    },
    {
      slug: 'derniere-chance',
      fr: 'Dernière chance',
      ar: 'الفرصة الأخيرة',
      en: 'Last chance',
      rules: [{ field: 'DISCOUNT' as const, operator: 'GREATER_THAN' as const, value: '0' }],
    },
    {
      slug: 'edition-limitee',
      fr: 'Éditions limitées',
      ar: 'إصدارات محدودة',
      en: 'Limited editions',
      rules: [{ field: 'TAG' as const, operator: 'EQUALS' as const, value: 'edition-limitee' }],
    },
  ];

  for (const [index, collection] of smart.entries()) {
    const row = await prisma.collection.upsert({
      where: { slug: collection.slug },
      create: {
        slug: collection.slug,
        name: tr(collection.fr, collection.ar, collection.en),
        isSmart: true,
        matchAll: true,
        position: index,
      },
      update: { name: tr(collection.fr, collection.ar, collection.en) },
    });
    await prisma.collectionRule.deleteMany({ where: { collectionId: row.id } });
    await prisma.collectionRule.createMany({
      data: collection.rules.map((rule) => ({ ...rule, collectionId: row.id })),
    });
  }

  // Manual collections.
  const manual = [
    { slug: 'heritage', fr: 'Heritage', ar: 'تراث', en: 'Heritage', tag: 'heritage' },
    { slug: 'ete', fr: 'Collection Été', ar: 'مجموعة الصيف', en: 'Summer collection', tag: 'ete' },
    { slug: 'hiver', fr: 'Collection Hiver', ar: 'مجموعة الشتاء', en: 'Winter collection', tag: 'hiver' },
  ];

  for (const [index, collection] of manual.entries()) {
    const row = await prisma.collection.upsert({
      where: { slug: collection.slug },
      create: {
        slug: collection.slug,
        name: tr(collection.fr, collection.ar, collection.en),
        isSmart: false,
        position: smart.length + index,
      },
      update: { name: tr(collection.fr, collection.ar, collection.en) },
    });
    const tagged = await prisma.product.findMany({
      where: { tags: { some: { tag: { slug: collection.tag } } } },
      select: { id: true },
    });
    for (const [position, product] of tagged.entries()) {
      await prisma.collectionProduct.upsert({
        where: { collectionId_productId: { collectionId: row.id, productId: product.id } },
        create: { collectionId: row.id, productId: product.id, position },
        update: { position },
      });
    }
  }

  log('collections', smart.length + manual.length);
  void productIds;
}
