import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  ReviewStatus,
  STOREFRONT_ERRORS,
  type PublicReview,
  type ReviewSubmitInput,
  type ReviewSummary,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RollupsService } from '../catalog/admin/rollups.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Reviews as shoppers see them — PRD F-ST-30.
 *
 * Only approved reviews are readable, and only the shop's own reply is shown beside
 * them. A submitted review is `PENDING` until a human approves it, which is what stops
 * a product page becoming a comment section.
 *
 * "Verified" means the phone or e-mail on the review belongs to a customer with a
 * delivered order containing that product. It is computed here, never sent by the
 * browser, because a badge the client can set is not a badge.
 */
@Injectable()
export class ReviewsPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollups: RollupsService,
    private readonly settings: SettingsService,
  ) {}

  /** Approved reviews for one product, with the star distribution beside them. */
  async forProduct(
    productId: string,
    page = 1,
    pageSize = 10,
    sort: 'recent' | 'helpful' | 'rating' = 'recent',
  ): Promise<ReviewSummary> {
    const where: Prisma.ReviewWhereInput = { productId, status: ReviewStatus.APPROVED };

    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      sort === 'helpful'
        ? { helpfulCount: 'desc' }
        : sort === 'rating'
          ? { rating: 'desc' }
          : { createdAt: 'desc' };

    const size = Math.min(Math.max(pageSize, 1), 50);
    const [rows, total, grouped, stats] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy,
        skip: (Math.max(page, 1) - 1) * size,
        take: size,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      this.prisma.review.aggregate({ where, _avg: { rating: true } }),
    ]);

    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const group of grouped) distribution[String(group.rating)] = group._count._all;

    return {
      average: Math.round((stats._avg.rating ?? 0) * 10) / 10,
      count: total,
      distribution,
      reviews: rows.map(toPublic),
      total,
      page: Math.max(page, 1),
      pageSize: size,
    };
  }

  /**
   * Accepts a review. Never returns it published: the response says it is awaiting
   * moderation, so nobody is surprised when it does not appear.
   */
  async submit(
    input: ReviewSubmitInput,
    customerId: string | null,
  ): Promise<{ status: 'pending'; verified: boolean }> {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That product does not exist' });
    }

    const identity = await this.resolveCustomer(customerId, input.phone, input.email);

    // One review per person per product. A second opinion is an edit, not a new row,
    // and without this a single shopper can move a rating on their own.
    if (identity) {
      const existing = await this.prisma.review.findFirst({
        where: { productId: input.productId, customerId: identity.id },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException({
          code: STOREFRONT_ERRORS.REVIEW_DUPLICATE,
          message: 'You have already reviewed this product',
        });
      }
    }

    const verified = identity ? await this.hasDeliveredOrder(identity.id, input.productId) : false;

    // The owner can decide reviews go live on arrival; the default is moderation.
    const autoApprove = await this.settings.get<boolean>('reviews.auto_approve', false);

    const review = await this.prisma.review.create({
      data: {
        productId: input.productId,
        customerId: identity?.id ?? null,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        authorName: input.authorName,
        verified,
        status: autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
      },
      select: { id: true, status: true },
    });

    if (review.status === ReviewStatus.APPROVED) {
      await this.rollups.refreshRating(input.productId);
    }

    return { status: 'pending', verified };
  }

  /**
   * Marks a review helpful. Deliberately not idempotent per visitor: there is no login
   * to key it on, and a counter that only ever rises is honest enough for a sort order.
   */
  async markHelpful(reviewId: string): Promise<{ helpfulCount: number }> {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, status: ReviewStatus.APPROVED },
      select: { id: true },
    });
    if (!review) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Review not found' });
    }
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });
    return updated;
  }

  private async resolveCustomer(
    customerId: string | null,
    phone?: string,
    email?: string,
  ): Promise<{ id: string } | null> {
    if (customerId) return { id: customerId };
    if (phone) {
      return this.prisma.customer.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
    }
    if (email) {
      return this.prisma.customer.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
    }
    return null;
  }

  private async hasDeliveredOrder(customerId: string, productId: string): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: {
        customerId,
        status: 'DELIVERED',
        items: { some: { variant: { productId } } },
      },
    });
    return count > 0;
  }
}

function toPublic(row: {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verified: boolean;
  reply: string | null;
  repliedAt: Date | null;
  helpfulCount: number;
  createdAt: Date;
}): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: row.authorName,
    verified: row.verified,
    reply: row.reply,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    helpfulCount: row.helpfulCount,
    createdAt: row.createdAt.toISOString(),
  };
}
