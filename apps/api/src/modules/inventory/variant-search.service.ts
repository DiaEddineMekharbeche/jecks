import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import type { Translated } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Variant lookup for every screen that adds a line to something — purchase orders here,
 * manual orders and returns later.
 *
 * It searches SKU, barcode and the product's accent-folded search text, and returns the
 * two numbers the operator needs to decide: what it costs and how many are left.
 */

export interface VariantHit {
  id: string;
  sku: string;
  barcode: string | null;
  productId: string;
  productName: Translated;
  variantName: string | null;
  imageUrl: string | null;
  priceMinor: string;
  costPriceMinor: string;
  available: number;
  onHand: number;
}

@Injectable()
export class VariantSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async search(term: string | undefined, limit = 20, locationId?: string): Promise<VariantHit[]> {
    const query = term?.trim();

    const where: Prisma.VariantWhereInput = {
      deletedAt: null,
      active: true,
      product: { deletedAt: null },
      ...(query
        ? {
            OR: [
              { sku: { contains: query, mode: 'insensitive' } },
              { barcode: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
              { product: { searchText: { contains: query.toLowerCase() } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.variant.findMany({
      where,
      take: Math.min(limit, 50),
      orderBy: [{ product: { salesCount: 'desc' } }, { sku: 'asc' }],
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        price: true,
        costPrice: true,
        productId: true,
        product: {
          select: {
            name: true,
            media: {
              where: { position: 0 },
              take: 1,
              select: { media: { select: { storageKey: true } } },
            },
          },
        },
        inventoryLevels: {
          where: locationId ? { locationId } : {},
          select: { onHand: true, reserved: true },
        },
      },
    });

    return rows.map((row) => {
      const onHand = row.inventoryLevels.reduce((sum, level) => sum + level.onHand, 0);
      const reserved = row.inventoryLevels.reduce((sum, level) => sum + level.reserved, 0);
      return {
        id: row.id,
        sku: row.sku,
        barcode: row.barcode,
        productId: row.productId,
        productName: row.product.name as Translated,
        variantName: row.name,
        imageUrl: this.storage.publicUrl(row.product.media[0]?.media.storageKey),
        priceMinor: row.price.toString(),
        costPriceMinor: row.costPrice.toString(),
        onHand,
        available: onHand - reserved,
      };
    });
  }
}
