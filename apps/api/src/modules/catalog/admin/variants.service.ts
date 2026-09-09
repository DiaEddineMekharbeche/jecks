import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  CATALOG_ERRORS,
  slugify,
  t,
  type PriceScheduleDto,
  type PriceScheduleInput,
  type Translated,
  type VariantGenerateInput,
  type VariantsPatchInput,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RollupsService } from './rollups.service.js';

/**
 * Variants, option sets and scheduled prices — PRD F-AD-10.
 *
 * The rule that shapes this whole file: a variant may already sit on an order, so it is
 * never deleted once it has been sold. Regenerating a matrix deactivates what no longer
 * applies; only a variant nothing has ever referenced is actually removed.
 */
@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollups: RollupsService,
  ) {}

  /**
   * Rebuilds the option sets and the variant matrix — "Colour x Size -> generate".
   *
   * Options and values are matched to what already exists by their French name rather
   * than replaced wholesale. That is what lets an operator add one size to a product
   * without every other variant losing its SKU, its price and its stock.
   */
  async generate(productId: string, input: VariantGenerateInput) {
    await this.assertProductExists(productId);

    await this.prisma.$transaction(async (tx) => {
      const existingOptions = await tx.productOption.findMany({
        where: { productId },
        include: { values: true },
      });

      /** Option value ids per option, in the order the operator arranged them. */
      const axes: string[][] = [];
      const keptOptionIds: string[] = [];

      for (const [index, option] of input.options.entries()) {
        const optionName = option.name.fr;
        const match = existingOptions.find((candidate) => nameOf(candidate.name) === optionName);

        const optionId = match
          ? (
              await tx.productOption.update({
                where: { id: match.id },
                data: {
                  name: option.name as Prisma.InputJsonValue,
                  kind: kindOf(optionName),
                  position: option.position || index,
                },
                select: { id: true },
              })
            ).id
          : (
              await tx.productOption.create({
                data: {
                  productId,
                  name: option.name as Prisma.InputJsonValue,
                  kind: kindOf(optionName),
                  position: option.position || index,
                },
                select: { id: true },
              })
            ).id;

        keptOptionIds.push(optionId);

        const valueIds: string[] = [];
        const keptValueIds: string[] = [];

        for (const [valueIndex, value] of option.values.entries()) {
          const existingValue = match?.values.find(
            (candidate) => nameOf(candidate.name) === value.name.fr,
          );

          const valueId = existingValue
            ? (
                await tx.productOptionValue.update({
                  where: { id: existingValue.id },
                  data: {
                    name: value.name as Prisma.InputJsonValue,
                    swatchHex: value.swatchHex ?? null,
                    position: value.position || valueIndex,
                  },
                  select: { id: true },
                })
              ).id
            : (
                await tx.productOptionValue.create({
                  data: {
                    optionId,
                    name: value.name as Prisma.InputJsonValue,
                    swatchHex: value.swatchHex ?? null,
                    position: value.position || valueIndex,
                  },
                  select: { id: true },
                })
              ).id;

          valueIds.push(valueId);
          keptValueIds.push(valueId);
        }

        // A value the operator removed goes away with its links; the variants that
        // used it are deactivated below rather than deleted.
        await tx.productOptionValue.deleteMany({
          where: { optionId, id: { notIn: keptValueIds } },
        });

        axes.push(valueIds);
      }

      await tx.productOption.deleteMany({
        where: { productId, id: { notIn: keptOptionIds } },
      });

      const combinations = cartesian(axes);
      if (combinations.length > 300) {
        throw new BadRequestException({
          code: 'TOO_MANY_VARIANTS',
          message: `Those options would make ${combinations.length} variants. Keep it under 300.`,
        });
      }

      const variants = await tx.variant.findMany({
        where: { productId, deletedAt: null },
        include: { optionValues: { select: { optionValueId: true } } },
      });

      const bySignature = new Map(
        variants.map((variant) => [
          signature(variant.optionValues.map((link) => link.optionValueId)),
          variant,
        ]),
      );

      const valueNames = await tx.productOptionValue.findMany({
        where: { id: { in: axes.flat() } },
        select: { id: true, name: true },
      });
      const nameById = new Map(valueNames.map((value) => [value.id, nameOf(value.name)]));

      const survivors: string[] = [];

      for (const [index, combination] of combinations.entries()) {
        const existing = bySignature.get(signature(combination));

        if (existing) {
          survivors.push(existing.id);
          await tx.variant.update({
            where: { id: existing.id },
            data: { position: index, active: true },
          });
          continue;
        }

        const suffix = combination.map((id) => skuPart(nameById.get(id) ?? '')).join('-');
        const sku = await this.freeSku(tx, `${input.skuPrefix}-${suffix}`);

        const created = await tx.variant.create({
          data: {
            productId,
            sku,
            price: input.price,
            compareAtPrice: input.compareAtPrice ?? null,
            costPrice: input.costPrice,
            weightGrams: input.weightGrams,
            position: index,
            name: combination.map((id) => nameById.get(id) ?? '').join(' / '),
            optionValues: {
              create: combination.map((optionValueId) => ({ optionValueId })),
            },
          },
          select: { id: true },
        });
        survivors.push(created.id);
      }

      // Anything outside the new matrix is retired: deleted if it has never been sold,
      // deactivated if it has, so an order placed last month still resolves its line to
      // a real SKU while the grid does not accumulate dead rows — most often the
      // placeholder variant every product is created with.
      const orphans = await tx.variant.findMany({
        where: { productId, id: { notIn: survivors }, deletedAt: null },
        select: { id: true },
      });
      if (orphans.length > 0) {
        await this.retire(
          tx,
          productId,
          orphans.map((variant) => variant.id),
        );
      }

      await this.rollups.refreshProduct(productId, tx);
    });

    return { productId };
  }

  /**
   * Writes the variant grid. Entries with an id are updated, entries without one are
   * created, and a variant the grid no longer lists is retired.
   */
  async patch(productId: string, input: VariantsPatchInput) {
    await this.assertProductExists(productId);

    const skus = input.variants.map((variant) => variant.sku.toLowerCase());
    const duplicate = skus.find((sku, index) => skus.indexOf(sku) !== index);
    if (duplicate) {
      throw new BadRequestException({
        code: 'SKU_TAKEN',
        message: `Duplicate SKU "${duplicate}" within the product`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.variant.findMany({
        where: { productId, deletedAt: null },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((variant) => variant.id));

      const clash = await tx.variant.findFirst({
        where: {
          sku: { in: input.variants.map((variant) => variant.sku) },
          productId: { not: productId },
          deletedAt: null,
        },
        select: { sku: true },
      });
      if (clash) {
        throw new ConflictException({
          code: 'SKU_TAKEN',
          message: CATALOG_ERRORS.SKU_TAKEN,
          details: { sku: clash.sku },
        });
      }

      const keptIds: string[] = [];

      for (const [index, variant] of input.variants.entries()) {
        const data = {
          sku: variant.sku,
          barcode: variant.barcode ?? null,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice ?? null,
          costPrice: variant.costPrice,
          weightGrams: variant.weightGrams,
          position: variant.position || index,
          active: variant.active,
        };

        const id =
          variant.id && existingIds.has(variant.id)
            ? (await tx.variant.update({ where: { id: variant.id }, data, select: { id: true } }))
                .id
            : (await tx.variant.create({ data: { ...data, productId }, select: { id: true } })).id;

        keptIds.push(id);

        await tx.variantOptionValue.deleteMany({ where: { variantId: id } });
        if (variant.optionValueIds.length > 0) {
          await tx.variantOptionValue.createMany({
            data: variant.optionValueIds.map((optionValueId) => ({
              variantId: id,
              optionValueId,
            })),
            skipDuplicates: true,
          });
        }

        await tx.variantMedia.deleteMany({ where: { variantId: id } });
        if (variant.mediaIds.length > 0) {
          await tx.variantMedia.createMany({
            data: variant.mediaIds.map((mediaId, position) => ({
              variantId: id,
              mediaId,
              position,
            })),
            skipDuplicates: true,
          });
        }
      }

      const removed = [...existingIds].filter((id) => !keptIds.includes(id));
      if (removed.length > 0) await this.retire(tx, productId, removed);

      await this.rollups.refreshProduct(productId, tx);
    });

    return { productId };
  }

  async reorder(productId: string, ids: string[]) {
    await this.assertProductExists(productId);

    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.variant.updateMany({ where: { id, productId }, data: { position } }),
      ),
    );

    return { productId };
  }

  // --- scheduled prices -----------------------------------------------------

  /**
   * Queues a price change. The worker applies it at `startsAt` and reverts it at
   * `endsAt`, so a flash sale needs no one awake at midnight (F-AD-10).
   */
  async schedulePrice(productId: string, input: PriceScheduleInput): Promise<PriceScheduleDto[]> {
    await this.assertProductExists(productId);

    const variants = await this.prisma.variant.findMany({
      where: { id: { in: input.variantIds }, productId, deletedAt: null },
      select: { id: true, sku: true },
    });
    if (variants.length === 0) {
      throw new BadRequestException({
        code: 'NO_VARIANTS',
        message: 'None of those variants belong to this product',
      });
    }

    const created = await this.prisma.$transaction(
      variants.map((variant) =>
        this.prisma.priceSchedule.create({
          data: {
            variantId: variant.id,
            price: input.price,
            compareAtPrice: input.compareAtPrice ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt ?? null,
          },
        }),
      ),
    );

    const skuById = new Map(variants.map((variant) => [variant.id, variant.sku]));
    return created.map((schedule) =>
      toScheduleDto(schedule, skuById.get(schedule.variantId) ?? ''),
    );
  }

  async cancelSchedule(scheduleId: string): Promise<void> {
    const schedule = await this.prisma.priceSchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true, appliedAt: true },
    });
    if (!schedule) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That schedule does not exist' });
    }
    if (schedule.appliedAt) {
      throw new ConflictException({
        code: 'ALREADY_APPLIED',
        message: 'That price change has already run. Edit the price directly instead.',
      });
    }
    await this.prisma.priceSchedule.delete({ where: { id: scheduleId } });
  }

  // --- internals ------------------------------------------------------------

  /**
   * A variant that has never been ordered is deleted outright; one that has is soft
   * deleted, keeping the row an order line points at.
   */
  private async retire(
    tx: Prisma.TransactionClient,
    productId: string,
    ids: string[],
  ): Promise<void> {
    const remaining = await tx.variant.count({
      where: { productId, deletedAt: null, id: { notIn: ids } },
    });
    if (remaining === 0) {
      throw new BadRequestException({
        code: 'LAST_VARIANT',
        message: CATALOG_ERRORS.LAST_VARIANT,
      });
    }

    const sold = await tx.orderItem.findMany({
      where: { variantId: { in: ids } },
      select: { variantId: true },
      distinct: ['variantId'],
    });
    const soldIds = new Set(sold.map((item) => item.variantId).filter(Boolean) as string[]);

    const deletable = ids.filter((id) => !soldIds.has(id));
    if (deletable.length > 0) {
      await tx.variant.deleteMany({ where: { id: { in: deletable } } });
    }
    if (soldIds.size > 0) {
      await tx.variant.updateMany({
        where: { id: { in: [...soldIds] } },
        data: { active: false, deletedAt: new Date() },
      });
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const exists = await this.prisma.product.count({ where: { id: productId, deletedAt: null } });
    if (exists === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }
  }

  private async freeSku(tx: Prisma.TransactionClient, base: string): Promise<string> {
    const root = base
      .toUpperCase()
      .replace(/[^A-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 56);
    for (let suffix = 0; suffix < 200; suffix += 1) {
      const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
      const taken = await tx.variant.count({ where: { sku: candidate } });
      if (taken === 0) return candidate;
    }
    return `${root}-${Date.now().toString(36).toUpperCase()}`;
  }
}

function toScheduleDto(
  schedule: {
    id: string;
    variantId: string;
    price: bigint;
    compareAtPrice: bigint | null;
    startsAt: Date;
    endsAt: Date | null;
    appliedAt: Date | null;
    revertedAt: Date | null;
  },
  sku: string,
): PriceScheduleDto {
  return {
    id: schedule.id,
    variantId: schedule.variantId,
    sku,
    price: schedule.price.toString(),
    compareAtPrice: schedule.compareAtPrice?.toString() ?? null,
    startsAt: schedule.startsAt.toISOString(),
    endsAt: schedule.endsAt?.toISOString() ?? null,
    appliedAt: schedule.appliedAt?.toISOString() ?? null,
    revertedAt: schedule.revertedAt?.toISOString() ?? null,
  };
}

/** Every combination of one value per option, in option order. */
export function cartesian(axes: string[][]): string[][] {
  return axes.reduce<string[][]>(
    (rows, axis) => rows.flatMap((row) => axis.map((value) => [...row, value])),
    [[]],
  );
}

/** Order-independent key for a variant's option values. */
export function signature(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|');
}

/** "Noir" -> "NOIR", "Taille unique" -> "TAILLEUN". */
export function skuPart(name: string): string {
  return slugify(name).replace(/-/g, '').toUpperCase().slice(0, 8) || 'X';
}

/**
 * The swatch renderer on the product page keys off this, so a colour option must be
 * recognised as one. French, English and Arabic labels all map to the same kind.
 */
function kindOf(name: string): string {
  const folded = slugify(name);
  if (['couleur', 'color', 'colour', 'lon'].includes(folded)) return 'color';
  if (['taille', 'size', 'pointure'].includes(folded)) return 'size';
  return 'text';
}

function nameOf(value: unknown): string {
  return t(value as Translated, 'fr');
}

export const __variantInternals = { cartesian, signature, skuPart, kindOf };
