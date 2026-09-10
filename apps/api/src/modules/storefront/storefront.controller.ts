import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  addressInputSchema,
  analyticsBatchSchema,
  contactSchema,
  newsletterSchema,
  notifyMeSchema,
  reviewSubmitSchema,
  trackOrderSchema,
  wishlistItemSchema,
  type AddressInput,
  type AnalyticsBatchInput,
  type ContactInput,
  type NewsletterInput,
  type NotifyMeInput,
  type ReviewSubmitInput,
  type TrackOrderInput,
  type WishlistItemInput,
} from '@jecks/shared';
import type { Request } from 'express';
import { Public, type RequestWithUser } from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import { EngagementService } from './engagement.service.js';
import { ReviewsPublicService } from './reviews.service.js';

/** Reviews as shoppers read and write them — PRD F-ST-30. */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsPublicService) {}

  @Get('product/:productId')
  @Public()
  @ApiOperation({ summary: 'Approved reviews for a product, with the star distribution' })
  @ApiQuery({ name: 'sort', required: false, enum: ['recent', 'helpful', 'rating'] })
  list(
    @Param('productId') productId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: 'recent' | 'helpful' | 'rating',
  ) {
    return this.reviews.forProduct(
      productId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 10,
      sort ?? 'recent',
    );
  }

  @Post()
  @Public()
  // A review takes minutes to write; five a minute from one address is a robot.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Submit a review; it waits for moderation' })
  submit(@Body(zod(reviewSubmitSchema)) body: ReviewSubmitInput, @Req() request: Request) {
    return this.reviews.submit(body, customerOf(request));
  }

  @Post(':id/helpful')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Mark a review helpful' })
  helpful(@Param('id') id: string) {
    return this.reviews.markHelpful(id);
  }
}

/** Wishlist, back-in-stock, newsletter, contact and analytics — PRD F-ST-31/32/50. */
@ApiTags('storefront')
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('wishlist')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in shopper’s wishlist' })
  list(@Req() request: Request) {
    return this.engagement.listWishlist(requireCustomer(request));
  }

  @Post('wishlist')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a product to the wishlist; adding twice is harmless' })
  add(@Body(zod(wishlistItemSchema)) body: WishlistItemInput, @Req() request: Request) {
    return this.engagement.addToWishlist(requireCustomer(request), body);
  }

  @Delete('wishlist/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a wishlist entry' })
  remove(@Param('id') id: string, @Req() request: Request) {
    return this.engagement.removeFromWishlist(requireCustomer(request), id);
  }

  @Post('stock-notifications')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Ask to be told when a variant is back in stock' })
  notifyMe(@Body(zod(notifyMeSchema)) body: NotifyMeInput, @Req() request: Request) {
    return this.engagement.notifyMe(body, customerOf(request));
  }

  @Post('marketing/newsletter')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Subscribe an e-mail address or a phone number' })
  subscribe(@Body(zod(newsletterSchema)) body: NewsletterInput) {
    return this.engagement.subscribe(body);
  }

  @Post('marketing/newsletter/unsubscribe')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Unsubscribe by e-mail or phone' })
  unsubscribe(@Body('identifier') identifier: string) {
    return this.engagement.unsubscribe(String(identifier ?? '').trim());
  }

  @Post('contact')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Send the shop a message' })
  contact(@Body(zod(contactSchema)) body: ContactInput) {
    return this.engagement.contact(body);
  }

  @Post('events')
  @Public()
  // A page sends one batch on unload; a hundred a minute is a page in a loop.
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  @ApiOperation({ summary: 'Record storefront analytics events, batched' })
  track(@Body(zod(analyticsBatchSchema)) body: AnalyticsBatchInput, @Req() request: Request) {
    return this.engagement.track(body, customerOf(request));
  }
}

/** The shopper's own account — PRD F-ST-51. */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOperation({ summary: 'Profile, loyalty balance and lifetime totals' })
  profile(@Req() request: Request) {
    return this.account.profile(requireCustomer(request));
  }

  @Patch()
  @ApiOperation({ summary: 'Update name, e-mail, language and marketing consent' })
  update(
    @Body()
    body: { fullName?: string; email?: string; locale?: string; acceptsMarketing?: boolean },
    @Req() request: Request,
  ) {
    return this.account.updateProfile(requireCustomer(request), body);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete the account, keeping the orders as accounting records' })
  remove(@Req() request: Request) {
    return this.account.deleteAccount(requireCustomer(request));
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Saved delivery addresses' })
  addresses(@Req() request: Request) {
    return this.account.listAddresses(requireCustomer(request));
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Save an address' })
  createAddress(@Body(zod(addressInputSchema)) body: AddressInput, @Req() request: Request) {
    return this.account.createAddress(requireCustomer(request), body);
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Update a saved address' })
  updateAddress(
    @Param('id') id: string,
    @Body(zod(addressInputSchema)) body: AddressInput,
    @Req() request: Request,
  ) {
    return this.account.updateAddress(requireCustomer(request), id, body);
  }

  @Delete('addresses/:id')
  @ApiOperation({ summary: 'Delete a saved address' })
  deleteAddress(@Param('id') id: string, @Req() request: Request) {
    return this.account.deleteAddress(requireCustomer(request), id);
  }

  @Get('orders')
  @ApiOperation({ summary: 'The shopper’s own orders' })
  orders(
    @Req() request: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.account.listOrders(
      requireCustomer(request),
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 10,
    );
  }

  @Get('orders/:number')
  @ApiOperation({ summary: 'One of the shopper’s orders, with its timeline' })
  order(@Param('number') number: string, @Req() request: Request) {
    return this.account.getOrder(requireCustomer(request), number.toUpperCase());
  }

  @Get('loyalty')
  @ApiOperation({ summary: 'The loyalty points ledger' })
  loyalty(@Req() request: Request) {
    return this.account.loyaltyLedger(requireCustomer(request));
  }
}

/** Public order tracking — PRD F-ST-52. Number plus phone, no account. */
@ApiTags('orders')
@Controller('orders')
export class TrackingController {
  constructor(private readonly account: AccountService) {}

  @Post('track')
  @Public()
  // Brute-forcing a phone against a number is the attack; ten a minute stops it.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Track an order with its number and the phone it was placed with' })
  track(@Body(zod(trackOrderSchema)) body: TrackOrderInput) {
    return this.account.track(body);
  }
}

function customerOf(request: Request): string | null {
  const user = (request as RequestWithUser).user;
  return user?.type === 'CUSTOMER' ? user.id : null;
}

/**
 * A shopper-only route. Staff tokens are rejected rather than silently treated as
 * anonymous, because an owner clicking "my wishlist" should see an explanation, not an
 * empty list that looks like data loss.
 */
function requireCustomer(request: Request): string {
  const customerId = customerOf(request);
  if (!customerId) {
    throw new ForbiddenException({
      code: 'NOT_A_CUSTOMER',
      message: 'Sign in with your phone number to use this',
    });
  }
  return customerId;
}
