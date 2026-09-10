import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CART_COOKIE,
  CART_TTL_DAYS,
  cartDeliverySchema,
  cartItemInputSchema,
  cartItemPatchSchema,
  cartPromoSchema,
  type CartDeliveryInput,
  type CartDto,
  type CartItemInput,
  type CartItemPatchInput,
  type CartPromoInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import { Public, type RequestWithUser } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CartService } from './cart.service.js';

/**
 * Cart — PRD F-ST-40/41.
 *
 * Public: a guest must be able to fill a basket. Identity, when there is one, comes
 * from the optional bearer token; the cart itself is addressed by an httpOnly cookie
 * the browser cannot read, so a cart token cannot be lifted by a script on the page.
 */
@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'The current cart, revalidated against stock and prices' })
  async get(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.cart.getOrCreate(tokenOf(request), customerOf(request));
    setCartCookie(response, result.token);
    return result;
  }

  @Post('items')
  @Public()
  // A basket is filled by hand; anything much faster than this is a script.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'Add a variant, or top up the line that already holds it' })
  async addItem(
    @Body(zod(cartItemInputSchema)) body: CartItemInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartDto> {
    const result = await this.cart.addItem(tokenOf(request), body, customerOf(request));
    setCartCookie(response, result.token);
    return result;
  }

  @Patch('items/:id')
  @Public()
  @ApiOperation({ summary: 'Set a line quantity; zero removes it' })
  async updateItem(
    @Param('id') id: string,
    @Body(zod(cartItemPatchSchema)) body: CartItemPatchInput,
    @Req() request: Request,
  ): Promise<CartDto> {
    return this.cart.updateItem(requireToken(request), id, body.quantity, customerOf(request));
  }

  @Delete('items/:id')
  @Public()
  @ApiOperation({ summary: 'Remove a line' })
  async removeItem(@Param('id') id: string, @Req() request: Request): Promise<CartDto> {
    return this.cart.removeItem(requireToken(request), id, customerOf(request));
  }

  @Delete()
  @Public()
  @ApiOperation({ summary: 'Empty the cart' })
  async clear(@Req() request: Request): Promise<CartDto> {
    return this.cart.clear(requireToken(request), customerOf(request));
  }

  @Post('promo')
  @Public()
  // Guessing codes is the one thing worth rate limiting hard on a cart.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Apply a promotion code, or say precisely why it was refused' })
  async applyPromo(
    @Body(zod(cartPromoSchema)) body: CartPromoInput,
    @Req() request: Request,
  ): Promise<CartDto> {
    return this.cart.applyPromo(requireToken(request), body.code, customerOf(request));
  }

  @Delete('promo')
  @Public()
  @ApiOperation({ summary: 'Remove the applied code' })
  async removePromo(@Req() request: Request): Promise<CartDto> {
    return this.cart.removePromo(requireToken(request), customerOf(request));
  }

  @Patch('delivery')
  @Public()
  @ApiOperation({ summary: 'Set the destination so shipping and totals become real' })
  async setDelivery(
    @Body(zod(cartDeliverySchema)) body: CartDeliveryInput,
    @Req() request: Request,
  ): Promise<CartDto> {
    return this.cart.setDelivery(requireToken(request), body, customerOf(request));
  }

  @Post('merge')
  @ApiOperation({ summary: 'Fold the guest cart into the signed-in customer’s own' })
  async merge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartDto> {
    const customerId = customerOf(request);
    if (!customerId) {
      // The guard has already required a token; a staff token has no cart to merge.
      return this.cart.getOrCreate(tokenOf(request), null);
    }
    const result = await this.cart.mergeOnLogin(tokenOf(request), customerId);
    setCartCookie(response, result.token);
    return result;
  }
}

function tokenOf(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[CART_COOKIE];
}

/**
 * Operations on an existing cart need a token. Returning an empty string rather than
 * throwing here would create a second cart silently, which is how a shopper watches
 * their basket empty itself.
 */
function requireToken(request: Request): string {
  return tokenOf(request) ?? '';
}

/** The signed-in shopper, when there is one. Staff tokens carry no customer. */
function customerOf(request: Request): string | null {
  const user = (request as RequestWithUser).user;
  return user?.type === 'CUSTOMER' ? user.id : null;
}

function setCartCookie(response: Response, token: string): void {
  response.cookie(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: CART_TTL_DAYS * 86_400_000,
  });
}
