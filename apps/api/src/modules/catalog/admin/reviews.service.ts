import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  ReviewStatus,
  type AdminListQuery,
  type AdminListResponse,
  type ReviewListFilters,
  type ReviewModerationInput,
  type ReviewRow,
  type Rendition,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { andWhere, listResponse, planExport, planList } from '../../../common/list/list.helper.js';
import type { ExportColumn } from '../../../common/list/export.service.js';
import { RollupsService } from './rollups.service.js';

export const REVIEW_SORTABLE = {
  createdAt: 'createdAt',
  rating: 'rating',
  status: 'status',
  helpful: 'helpfulCount',
} as const;

/**
 * Review moderation — PRD F-AD-12.
 *
 * Only approved reviews count toward the rating a shopper sees, so every status change
 * recomputes the product's rating rollup in the same transaction (D25). Moderating a
 * review and having the star average lag behind is the bug this design removes.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rollups: RollupsService,
  ) {}

  async list(
    query: AdminListQuery,
    filters: ReviewListFilters,
  ): Promise<AdminListResponse<ReviewRow>> {
    const where = this.buildWhere(query, filters);
    const plan = planList(query, REVIEW_SORTABLE, 'createdAt');

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({ where, ...plan, include: REVIEW_INCLUDE }),
      this.prisma.review.count({ where }),
    ]);

    return listResponse(
      query,
      rows.map((row) => this.toRow(row)),
      total,
    );
  }

  async listForExport(query: AdminListQuery, filters: ReviewListFilters): Promise<ReviewRow[]> {
    const where = this.buildWhere(query, filters);
    const total = await this.prisma.review.count({ where });
    const { take } = planExport(total);

    const rows = await this.prisma.review.findMany({
      where,
      take,
      orderBy: planList(query, REVIEW_SORTABLE, 'createdAt').orderBy,
      include: REVIEW_INCLUDE,
    });

    return rows.map((row) => this.toRow(row));
  }

  /** Counters for the moderation tabs, ignoring the status filter itself. */
  async statusCounts(filters: ReviewListFilters): Promise<Record<string, number>> {
    const { status: _ignored, ...rest } = filters;
    const where = this.buildWhere({ page: 1, pageSize: 1, order: 'desc' }, rest);

    const grouped = await this.prisma.review.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const counts: Record<string, number> = { ALL: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return counts;
  }

  /** Approve or reject, one review or a whole selection. */
  async moderate(input: ReviewModerationInput): Promise<{ updated: number }> {
    const reviews = await this.prisma.review.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, productId: true },
    });
    if (reviews.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'None of those reviews exist' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.review.updateMany({
        where: { id: { in: reviews.map((review) => review.id) } },
        data: { status: input.status },
      });
      await this.rollups.refreshRatings(
        reviews.map((review) => review.productId),
        tx,
      );
    });

    return { updated: reviews.length };
  }

  /** The shop's public answer under a review. An empty string clears it. */
  async reply(id: string, reply: string): Promise<ReviewRow> {
    const exists = await this.prisma.review.count({ where: { id } });
    if (exists === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That review does not exist' });
    }

    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        reply: reply.length > 0 ? reply : null,
        repliedAt: reply.length > 0 ? new Date() : null,
      },
      include: REVIEW_INCLUDE,
    });

    return this.toRow(updated);
  }

  async remove(id: string): Promise<void> {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: { id: true, productId: true },
    });
    if (!review) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That review does not exist' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });
      await this.rollups.refreshRating(review.productId, tx);
    });
  }

  // --- internals ------------------------------------------------------------

  private buildWhere(query: AdminListQuery, filters: ReviewListFilters): Prisma.ReviewWhereInput {
    const ratings = (filters.rating ?? []).map(Number).filter(Number.isFinite);

    return andWhere(
      filters.status?.length ? { status: { in: filters.status as never } } : undefined,
      ratings.length > 0 ? { rating: { in: ratings } } : undefined,
      filters.productId?.length ? { productId: { in: filters.productId } } : undefined,
      filters.verified?.length ? { verified: filters.verified[0] === 'true' } : undefined,
      query.q?.trim()
        ? {
            OR: [
              { body: { contains: query.q.trim(), mode: 'insensitive' } },
              { title: { contains: query.q.trim(), mode: 'insensitive' } },
              { authorName: { contains: query.q.trim(), mode: 'insensitive' } },
            ],
          }
        : undefined,
    ) as Prisma.ReviewWhereInput;
  }

  private toRow(row: ReviewShape): ReviewRow {
    const productMedia = row.product.media[0]?.media;
    const thumb = ((productMedia?.renditions as Rendition[] | null) ?? []).find(
      (rendition) => rendition.name === 'thumb' && rendition.format === 'webp',
    );

    return {
      id: row.id,
      productId: row.productId,
      productName: (row.product.name ?? {}) as Translated,
      productSlug: row.product.slug,
      thumbnailUrl: this.storage.publicUrl(thumb?.key ?? productMedia?.storageKey),
      customerId: row.customerId,
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.authorName,
      status: row.status as ReviewStatus,
      verified: row.verified,
      reply: row.reply,
      repliedAt: row.repliedAt?.toISOString() ?? null,
      helpfulCount: row.helpfulCount,
      mediaUrls: row.media
        .map((item) => this.storage.publicUrl(item.media.storageKey))
        .filter((url): url is string => Boolean(url)),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const REVIEW_INCLUDE = {
  product: {
    select: {
      name: true,
      slug: true,
      media: {
        take: 1,
        orderBy: { position: 'asc' },
        select: { media: { select: { storageKey: true, renditions: true } } },
      },
    },
  },
  media: {
    orderBy: { position: 'asc' },
    select: { media: { select: { storageKey: true } } },
  },
} satisfies Prisma.ReviewInclude;

type ReviewShape = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

export const REVIEW_EXPORT_COLUMNS: ExportColumn<ReviewRow>[] = [
  { header: 'Date', value: (row) => new Date(row.createdAt) },
  { header: 'Produit', value: (row) => row.productName.fr ?? '', width: 32 },
  { header: 'Note', value: (row) => row.rating },
  { header: 'Statut', value: (row) => row.status },
  { header: 'Achat vérifié', value: (row) => (row.verified ? 'oui' : 'non') },
  { header: 'Auteur', value: (row) => row.authorName, width: 20 },
  { header: 'Titre', value: (row) => row.title, width: 28 },
  { header: 'Avis', value: (row) => row.body, width: 60 },
  { header: 'Réponse', value: (row) => row.reply, width: 40 },
  { header: 'Utile', value: (row) => row.helpfulCount },
];
