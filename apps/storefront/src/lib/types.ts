import type { Locale, Translated } from '@jecks/shared';

/**
 * Response shapes of the public catalog endpoints. Written by hand rather than
 * generated, because the storefront needs only a slice of what the API returns and
 * a narrow type is what keeps the RSC payload small.
 */

export interface MediaRef {
  storageKey: string;
  alt?: Translated | null;
  width?: number | null;
  height?: number | null;
  kind?: string;
  posterKey?: string | null;
}

export interface OptionValue {
  id: string;
  name: Translated;
  swatchHex?: string | null;
  media?: { storageKey: string } | null;
}

export interface ProductCard {
  id: string;
  slug: string;
  name: Translated;
  shortDescription?: Translated | null;
  styleLabel?: string | null;
  minPrice: string;
  maxPrice: string;
  maxCompareAt?: string | null;
  totalStock: number;
  ratingAverage: string | number;
  ratingCount: number;
  salesCount: number;
  publishedAt: string | null;
  brand?: { slug: string; name: string } | null;
  category?: { slug: string; name: Translated } | null;
  tags: Array<{ tag: { slug: string; name: Translated } }>;
  media: Array<{ media: MediaRef }>;
  options: Array<{ values: OptionValue[] }>;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string | null;
  price: string;
  compareAtPrice: string | null;
  weightGrams: number;
  optionValues: Array<{ optionValueId: string }>;
  available: number;
  inStock: boolean;
}

export interface ProductDetail extends Omit<ProductCard, 'options' | 'media'> {
  description?: Translated | null;
  media: Array<{ position: number; media: MediaRef & { id: string } }>;
  options: Array<{ id: string; name: Translated; kind: string; values: OptionValue[] }>;
  variants: ProductVariant[];
  attributes: Array<{ value: Translated; attribute: { key: string; name: Translated; position: number } }>;
  sizeGuide?: { id: string; name: Translated; body: Translated } | null;
  category?: { slug: string; name: Translated; path?: string } | null;
}

export interface CollectionSummary {
  id: string;
  slug: string;
  name: Translated;
  description?: Translated | null;
  isSmart: boolean;
  media?: MediaRef | null;
}

export interface HomeSection {
  id: string;
  kind: string;
  title?: Translated | null;
  subtitle?: Translated | null;
  ctaLabel?: Translated | null;
  ctaUrl?: string | null;
  config?: Record<string, unknown> | null;
  position: number;
  media?: MediaRef | null;
  collection?: { slug: string; name: Translated } | null;
}

export interface Announcement {
  id: string;
  message: Translated;
  linkUrl?: string | null;
  bgColor?: string | null;
  textColor?: string | null;
}

export interface MenuNode {
  id: string;
  parentId: string | null;
  label: Translated;
  url: string;
  position: number;
  children?: MenuNode[];
}

export interface Bootstrap {
  settings: Record<string, unknown>;
  menus: Array<{ slug: string; items: MenuNode[] }>;
  announcements: Announcement[];
}

export interface Facets {
  tags: Array<{ slug: string; name: Translated; _count: { products: number } }>;
  categories: Array<{ slug: string; name: Translated; _count: { products: number } }>;
  brands: Array<{ slug: string; name: string; _count: { products: number } }>;
  price: { min: string; max: string };
}

export interface Wilaya {
  code: number;
  name: Translated;
  nameAscii: string;
}

export interface ShippingQuote {
  wilayaCode: number;
  deliveryType: 'HOME' | 'STOP_DESK';
  courierName: string | null;
  price: string;
  freeShippingApplied: boolean;
  etaMinDays: number;
  etaMaxDays: number;
}

export interface CmsPage {
  slug: string;
  title: Translated;
  body: Translated;
  kind: string;
}

export interface LocaleParams {
  locale: Locale;
}
