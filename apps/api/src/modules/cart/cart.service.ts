import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DeliveryType, Prisma } from '@jecks/db';
import {
  CART_ERRORS,
  CART_TTL_DAYS,
  t,
  type CartDeliveryInput,
  type CartDto,
  type CartItemDto,
  type CartItemInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShippingService } from '../shipping/shipping.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { CartLine, PromoResult } from '../promotions/engine/types.js';

/**
 * The cart — PRD F-ST-40/41.
 *
 * Every read revalidates against reality before answering: the price the shopper saw,
 * the stock still on the shelf, and whether the promo code they typed a week ago is
 * still live. A cart that reports a total the checkout will refuse is worse than a
 * cart that quietly corrected itself and said so.
 *
 * The browser holds an opaque token; the cart id never leaves the server, so a guessed
 * id is not a way into someone else's basket.
 */

const ITEM_INCLUDE = {
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      compareAtPrice: true,
      weightGrams: true,
      active: true,
      deletedAt: true,
      productId: true,
      inventoryLevels: { select: { onHand: true, reserved: true } },
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          deletedAt: true,
          categoryId: true,
          allowBackorder: true,
          trackInventory: true,
          collections: { select: { collectionId: true } },
          media: {
            where: { position: 0 },
            take: 1,
            select: { media: { select: { storageKey: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

const CART_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const }, include: ITEM_INCLUDE },
} satisfies Prisma.CartInclude;

type CartRecord = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;
type CartItemRecord = CartRecord['items'][number];

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly shipping: ShippingService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // --- lifecycle ------------------------------------------------------------

  /** Reads a cart by token, creating one when the browser has none. */
  async getOrCreate(token: string | undefined, customerId: string | null): Promise<CartDto> {
    const existing = token ? await this.findByToken(token) : null;
    if (existing) return this.present(existing, customerId);

    const created = await this.prisma.cart.create({
      data: {
        token: newToken(),
        customerId,
        expiresAt: expiryFromNow(),
      },
      include: CART_INCLUDE,
    });
    return this.present(created, customerId);
  }

  async get(token: string, customerId: string | null): Promise<CartDto> {
    return this.present(await this.require(token), customerId);
  }

  /**
   * Adds a line, or tops one up when the variant is already in the cart.
   *
   * The price is snapshotted at this moment. `present()` compares it against the live
   * price on every read, so a shopper is told the price moved rather than silently
   * charged the new one.
   */
  async addItem(
    token: string | undefined,
    input: CartItemInput,
    customerId: string | null,
  ): Promise<CartDto> {
    const cart = token ? await this.findByToken(token) : null;
    const target =
      cart ??
      (await this.prisma.cart.create({
        data: { token: newToken(), customerId, expiresAt: expiryFromNow() },
        include: CART_INCLUDE,
      }));

    const variant = await this.prisma.variant.findFirst({
      where: { id: input.variantId, deletedAt: null, active: true },
      select: {
        id: true,
        price: true,
        product: { select: { status: true, deletedAt: true, allowBackorder: true, trackInventory: true } },
        inventoryLevels: { select: { onHand: true, reserved: true } },
      },
    });

    if (!variant || variant.product.deletedAt || variant.product.status !== 'ACTIVE') {
      throw new NotFoundException({
        code: CART_ERRORS.VARIANT_UNAVAILABLE,
        message: 'That item is no longer for sale',
      });
    }

    const existingLine = target.items.find((item) => item.variantId === input.variantId);
    const wanted = (existingLine?.quantity ?? 0) + input.quantity;
    const available = availableOf(variant.inventoryLevels);
    const capped = capQuantity(wanted, available, variant.product);

    if (capped === 0) {
      throw new BadRequestException({
        code: CART_ERRORS.OUT_OF_STOCK,
        message: 'That item just sold out',
        details: { variantId: input.variantId, available },
      });
    }

    await this.prisma.cartItem.upsert({
      where: {
        cartId_variantId_bundleId: {
          cartId: target.id,
          variantId: input.variantId,
          bundleId: null as unknown as string,
        },
      },
      create: {
        cartId: target.id,
        variantId: input.variantId,
        quantity: capped,
        unitPrice: variant.price,
      },
      update: { quantity: capped },
    });

    await this.touch(target.id, customerId);
    return this.present(await this.requireById(target.id), customerId);
  }

  async updateItem(
    token: string,
    itemId: string,
    quantity: number,
    customerId: string | null,
  ): Promise<CartDto> {
    const cart = await this.require(token);
    const line = cart.items.find((item) => item.id === itemId);
    if (!line) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That line is no longer in your cart' });
    }

    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      const available = availableOf(line.variant.inventoryLevels);
      const capped = capQuantity(quantity, available, line.variant.product);
      if (capped === 0) {
        await this.prisma.cartItem.delete({ where: { id: itemId } });
      } else {
        await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity: capped } });
      }
    }

    await this.touch(cart.id, customerId);
    return this.present(await this.requireById(cart.id), customerId);
  }

  async removeItem(token: string, itemId: string, customerId: string | null): Promise<CartDto> {
    const cart = await this.require(token);
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    await this.touch(cart.id, customerId);
    return this.present(await this.requireById(cart.id), customerId);
  }

  async clear(token: string, customerId: string | null): Promise<CartDto> {
    const cart = await this.require(token);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCode: null } });
    return this.present(await this.requireById(cart.id), customerId);
  }

  // --- promo and delivery ---------------------------------------------------

  /**
   * Stores a code and re-evaluates. A code that the engine refuses is not stored, and
   * the refusal comes back with the sentence the shopper should read.
   */
  async applyPromo(token: string, code: string, customerId: string | null): Promise<CartDto> {
    const cart = await this.require(token);
    const trial = await this.present(cart, customerId, [code]);

    const rejection = trial.rejectedCodes.find((entry) => entry.code === code);
    if (rejection) {
      throw new BadRequestException({
        code: CART_ERRORS.PROMO_REJECTED,
        message: rejection.message,
        details: { reason: rejection.reason },
      });
    }

    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCode: code } });
    return this.present(await this.requireById(cart.id), customerId);
  }

  async removePromo(token: string, customerId: string | null): Promise<CartDto> {
    const cart = await this.require(token);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { promoCode: null } });
    return this.present(await this.requireById(cart.id), customerId);
  }

  /** Sets the destination, which is what makes shipping quotable and totals real. */
  async setDelivery(
    token: string,
    input: CartDeliveryInput,
    customerId: string | null,
  ): Promise<CartDto> {
    const cart = await this.require(token);
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        wilayaCode: input.wilayaCode ?? null,
        deliveryType: (input.deliveryType ?? null) as DeliveryType | null,
      },
    });
    return this.present(await this.requireById(cart.id), customerId);
  }

  /**
   * Merges a guest cart into the signed-in customer's own on login — PRD F-ST-41.
   *
   * Quantities are summed rather than replaced: a shopper who added two caps on their
   * phone and one on a laptop wants three, not one.
   */
  async mergeOnLogin(guestToken: string | undefined, customerId: string): Promise<CartDto> {
    const guest = guestToken ? await this.findByToken(guestToken) : null;

    const owned = await this.prisma.cart.findFirst({
      where: { customerId, convertedOrderId: null, NOT: guest ? { id: guest.id } : undefined },
      orderBy: { updatedAt: 'desc' },
      include: CART_INCLUDE,
    });

    if (!guest) {
      return owned
        ? this.present(owned, customerId)
        : this.getOrCreate(undefined, customerId);
    }

    if (!owned) {
      await this.prisma.cart.update({ where: { id: guest.id }, data: { customerId } });
      return this.present(await this.requireById(guest.id), customerId);
    }

    for (const line of guest.items) {
      const existing = owned.items.find((item) => item.variantId === line.variantId);
      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(existing.quantity + line.quantity, 99) },
        });
      } else {
        await this.prisma.cartItem.create({
          data: {
            cartId: owned.id,
            variantId: line.variantId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          },
        });
      }
    }

    // The guest cart is deleted rather than kept: two live carts for one person is how
    // an order goes out missing the items they added on the other device.
    await this.prisma.cart.delete({ where: { id: guest.id } });
    await this.touch(owned.id, customerId);
    return this.present(await this.requireById(owned.id), customerId);
  }

  /** The lines and the promo result a checkout needs, revalidated the same way. */
  async forCheckout(
    token: string,
    customerId: string | null,
    wilayaCode: number,
    deliveryType: DeliveryType,
  ): Promise<{ cart: CartRecord; lines: CartLine[]; promo: PromoResult; shippingMinor: bigint }> {
    const cart = await this.require(token);
    const usable = cart.items.filter((item) => sellable(item));
    if (usable.length === 0) {
      throw new BadRequestException({
        code: CART_ERRORS.CART_EMPTY,
        message: 'Your cart is empty',
      });
    }

    const lines = usable.map((item) => this.toLine(item));
    const weight = usable.reduce(
      (sum, item) => sum + item.variant.weightGrams * item.quantity,
      0,
    );
    const subtotal = lines.reduce(
      (sum, line) => sum + line.unitPriceMinor * BigInt(line.quantity),
      0n,
    );

    const quote = await this.shipping.quote({
      wilayaCode,
      deliveryType,
      weightGrams: weight,
      subtotal,
    });

    const promo = await this.promotions.evaluate({
      lines,
      customerId,
      wilayaCode,
      codes: cart.promoCode ? [cart.promoCode] : [],
      shippingMinor: quote.price,
    });

    return { cart, lines, promo, shippingMinor: quote.price };
  }

  // --- presentation ---------------------------------------------------------

  /**
   * Turns a row into the shape the storefront renders, revalidating as it goes.
   *
   * `extraCodes` lets `applyPromo` try a code without storing it, so a refused code
   * never ends up saved on the cart.
   */
  private async present(
    cart: CartRecord,
    customerId: string | null,
    extraCodes: string[] = [],
  ): Promise<CartDto> {
    const notices: string[] = [];
    const items: CartItemDto[] = [];
    const lines: CartLine[] = [];

    for (const item of cart.items) {
      if (!sellable(item)) {
        notices.push(
          `« ${t(item.variant.product.name as Translated, 'fr')} » n’est plus disponible et a été retiré.`,
        );
        await this.prisma.cartItem.delete({ where: { id: item.id } }).catch(() => undefined);
        continue;
      }

      const available = availableOf(item.variant.inventoryLevels);
      const capped = capQuantity(item.quantity, available, item.variant.product);

      let adjusted: CartItemDto['adjusted'] = null;

      if (capped === 0) {
        notices.push(
          `« ${t(item.variant.product.name as Translated, 'fr')} » est en rupture et a été retiré.`,
        );
        await this.prisma.cartItem.delete({ where: { id: item.id } }).catch(() => undefined);
        continue;
      }

      if (capped !== item.quantity) {
        adjusted = 'quantity';
        notices.push(
          `Il ne reste que ${capped} « ${t(item.variant.product.name as Translated, 'fr')} ».`,
        );
        await this.prisma.cartItem
          .update({ where: { id: item.id }, data: { quantity: capped } })
          .catch(() => undefined);
      }

      // The snapshot is kept, not overwritten: the shopper is told the price changed
      // and charged the current one at checkout, which is the honest order of events.
      if (item.unitPrice !== item.variant.price) adjusted = adjusted ?? 'price';

      const quantity = capped;
      const unitPrice = item.variant.price;

      items.push({
        id: item.id,
        variantId: item.variantId,
        productId: item.variant.product.id,
        productName: item.variant.product.name as Translated,
        productSlug: item.variant.product.slug,
        variantName: item.variant.name,
        sku: item.variant.sku,
        imageUrl: this.storage.publicUrl(item.variant.product.media[0]?.media.storageKey),
        quantity,
        unitPriceMinor: unitPrice.toString(),
        currentUnitPriceMinor: item.variant.price.toString(),
        compareAtPriceMinor: item.variant.compareAtPrice?.toString() ?? null,
        lineTotalMinor: (unitPrice * BigInt(quantity)).toString(),
        discountMinor: '0',
        available,
        adjusted,
      });

      lines.push(this.toLine({ ...item, quantity }));
    }

    const subtotal = lines.reduce(
      (sum, line) => sum + line.unitPriceMinor * BigInt(line.quantity),
      0n,
    );
    const weight = cart.items.reduce(
      (sum, item) => sum + item.variant.weightGrams * item.quantity,
      0,
    );

    // Shipping is only quotable once a destination is known; before that the drawer
    // shows the merchandise total and says shipping is calculated at checkout.
    let shippingMinor = 0n;
    let shippingQuoted = false;
    let wilayaName: string | null = null;

    if (cart.wilayaCode !== null && cart.deliveryType !== null) {
      const [quote, wilaya] = await Promise.all([
        this.shipping
          .quote({
            wilayaCode: cart.wilayaCode,
            deliveryType: cart.deliveryType,
            weightGrams: weight,
            subtotal,
          })
          .catch(() => null),
        this.prisma.wilaya.findUnique({
          where: { code: cart.wilayaCode },
          select: { name: true },
        }),
      ]);
      if (quote) {
        shippingMinor = quote.price;
        shippingQuoted = true;
      }
      wilayaName = wilaya ? t(wilaya.name as Translated, 'fr') : null;
    }

    const codes = [...(cart.promoCode ? [cart.promoCode] : []), ...extraCodes];
    const promo = await this.promotions.evaluate({
      lines,
      customerId: customerId ?? cart.customerId,
      wilayaCode: cart.wilayaCode,
      codes,
      shippingMinor,
    });

    const discountByLine = new Map(
      promo.lineDiscounts.map((entry) => [entry.lineId, entry.amountMinor]),
    );
    for (const item of items) {
      item.discountMinor = (discountByLine.get(item.id) ?? 0n).toString();
    }

    const threshold = BigInt(
      await this.settings.get<number>('checkout.free_shipping_threshold', 0),
    );
    const afterDiscount = subtotal - promo.discountMinor;
    const remaining = threshold > 0n ? threshold - afterDiscount : 0n;

    return {
      id: cart.id,
      token: cart.token,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      items,

      currency: cart.currency,
      subtotalMinor: subtotal.toString(),
      discountMinor: promo.discountMinor.toString(),
      shippingMinor: promo.shippingMinor.toString(),
      totalMinor: (afterDiscount + promo.shippingMinor).toString(),
      weightGrams: weight,

      wilayaCode: cart.wilayaCode,
      wilayaName,
      deliveryType: cart.deliveryType,
      shippingQuoted,

      promotions: promo.applied.map((entry) => ({
        promotionId: entry.promotionId,
        name: entry.name,
        code: entry.code,
        amountMinor: entry.amountMinor.toString(),
        freeShipping: entry.freeShipping,
      })),
      rejectedCodes: promo.rejected.map((entry) => ({
        code: entry.code,
        reason: entry.reason,
        message: entry.message,
      })),
      appliedCode: promo.applied.find((entry) => entry.code)?.code ?? null,

      freeShippingThresholdMinor: threshold > 0n ? threshold.toString() : null,
      freeShippingRemainingMinor:
        threshold > 0n ? (remaining > 0n ? remaining : 0n).toString() : null,
      freeShipping: promo.freeShipping || (threshold > 0n && remaining <= 0n),

      notices,
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private toLine(item: CartItemRecord): CartLine {
    return {
      id: item.id,
      variantId: item.variantId,
      productId: item.variant.product.id,
      categoryId: item.variant.product.categoryId,
      collectionIds: item.variant.product.collections.map((link) => link.collectionId),
      quantity: item.quantity,
      unitPriceMinor: item.variant.price,
    };
  }

  // --- lookups --------------------------------------------------------------

  private async findByToken(token: string): Promise<CartRecord | null> {
    return this.prisma.cart.findFirst({
      where: { token, convertedOrderId: null },
      include: CART_INCLUDE,
    });
  }

  private async require(token: string): Promise<CartRecord> {
    const cart = await this.findByToken(token);
    if (!cart) {
      throw new NotFoundException({
        code: CART_ERRORS.CART_NOT_FOUND,
        message: 'Your cart has expired. Add your items again.',
      });
    }
    return cart;
  }

  private async requireById(id: string): Promise<CartRecord> {
    const cart = await this.prisma.cart.findUnique({ where: { id }, include: CART_INCLUDE });
    if (!cart) {
      throw new NotFoundException({ code: CART_ERRORS.CART_NOT_FOUND, message: 'Cart not found' });
    }
    return cart;
  }

  /** Pushes the expiry out and claims the cart for a customer who has signed in. */
  private async touch(cartId: string, customerId: string | null): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        expiresAt: expiryFromNow(),
        ...(customerId ? { customerId } : {}),
      },
    });
  }
}

// --- pure helpers -----------------------------------------------------------

/** 32 random bytes: unguessable, and short enough for a cookie. */
function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function expiryFromNow(): Date {
  return new Date(Date.now() + CART_TTL_DAYS * 86_400_000);
}

export function availableOf(levels: Array<{ onHand: number; reserved: number }>): number {
  return levels.reduce((sum, level) => sum + Math.max(level.onHand - level.reserved, 0), 0);
}

/**
 * How many units of a line may stand.
 *
 * A product that does not track inventory, or that allows backorders, is never capped:
 * the shop has said it can supply it. Everything else is limited to what is on the
 * shelf, because promising stock that does not exist is how a COD order becomes a
 * failed delivery.
 */
export function capQuantity(
  wanted: number,
  available: number,
  product: { trackInventory: boolean; allowBackorder: boolean },
): number {
  const requested = Math.max(Math.trunc(wanted), 0);
  if (requested === 0) return 0;
  if (!product.trackInventory || product.allowBackorder) return Math.min(requested, 99);
  return Math.min(requested, Math.max(available, 0), 99);
}

function sellable(item: CartItemRecord): boolean {
  return (
    item.variant.active &&
    item.variant.deletedAt === null &&
    item.variant.product.deletedAt === null &&
    item.variant.product.status === 'ACTIVE'
  );
}
