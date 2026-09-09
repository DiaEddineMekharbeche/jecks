import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  ACCEPTED_MIME_TYPES,
  MAX_BYTES_BY_KIND,
  MEDIA_ERRORS,
  MediaKind,
  type AdminListResponse,
  type MediaDto,
  type MediaFolderDto,
  type MediaListQuery,
  type MediaPatchInput,
  type Rendition,
} from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { QueueService } from '../queue/queue.service.js';
import { andWhere, listResponse, planList, searchFilter } from '../../common/list/list.helper.js';
import { SNIFF_BYTES, sniffFileType } from './file-sniffer.js';

export const MEDIA_SORTABLE = {
  createdAt: 'createdAt',
  fileName: 'fileName',
  sizeBytes: 'sizeBytes',
} as const;

/** Relations that count as a usage; deleting a referenced file is refused. */
const USAGE_RELATIONS = [
  'productMedia',
  'variantMedia',
  'reviewMedia',
  'optionSwatches',
  'brandLogos',
  'categoryMedia',
  'collectionMedia',
  'collectionHeroes',
  'bannerMedia',
  'homeSectionMedia',
  'userAvatars',
  'pageHeroes',
] as const;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  // --- upload ---------------------------------------------------------------

  /**
   * Stores one uploaded file and queues it for processing.
   *
   * The declared content type is ignored: the bytes decide. A file whose contents do
   * not match any accepted format is refused before it reaches the disk, so an
   * executable renamed to `.jpg` never lands in the media root.
   */
  async upload(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    options: { folderId?: string; alt?: string } = {},
  ): Promise<MediaDto> {
    const sniffed = sniffFileType(file.buffer.subarray(0, SNIFF_BYTES * 32));

    if (!sniffed) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_TYPE',
        message: MEDIA_ERRORS.UNSUPPORTED_TYPE,
        details: { received: file.mimetype },
      });
    }

    const accepted = ACCEPTED_MIME_TYPES[sniffed.kind] as readonly string[];
    if (!accepted.includes(sniffed.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_TYPE',
        message: MEDIA_ERRORS.UNSUPPORTED_TYPE,
      });
    }

    const limit = MAX_BYTES_BY_KIND[sniffed.kind];
    if (file.size > limit) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `${MEDIA_ERRORS.FILE_TOO_LARGE} (max ${Math.round(limit / 1024 / 1024)} MB)`,
      });
    }

    if (options.folderId) await this.assertFolderExists(options.folderId);

    // Content hash doubles as the storage path, so the same file uploaded twice does
    // not occupy the disk twice, and as a cheap integrity check.
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const safeName = sanitizeFileName(file.originalname, sniffed.extension);
    const storageKey = `media/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}.${sniffed.extension}`;

    await this.storage.put(storageKey, file.buffer);

    const media = await this.prisma.media.create({
      data: {
        kind: sniffed.kind,
        folderId: options.folderId ?? null,
        storageKey,
        fileName: safeName,
        mimeType: sniffed.mimeType,
        sizeBytes: file.size,
        checksum,
        alt: options.alt ? { fr: options.alt } : undefined,
        // SVG needs no renditions and 3D needs different work; both are marked done
        // here so the library does not show them as perpetually processing.
        processedAt: needsProcessing(sniffed.kind, sniffed.mimeType) ? null : new Date(),
      },
      include: this.usageInclude(),
    });

    if (needsProcessing(sniffed.kind, sniffed.mimeType)) {
      await this.queue.processMedia(media.id);
    }

    return this.toDto(media);
  }

  // --- read -----------------------------------------------------------------

  async list(query: MediaListQuery): Promise<AdminListResponse<MediaDto>> {
    const where = andWhere(
      { deletedAt: null },
      query.kind ? { kind: query.kind } : undefined,
      // `folderId=root` means the top level, which is a null column value.
      query.folderId === 'root'
        ? { folderId: null }
        : query.folderId
          ? { folderId: query.folderId }
          : undefined,
      query.unusedOnly ? this.unusedFilter() : undefined,
      searchFilter(query.q, ['fileName']),
    ) as Prisma.MediaWhereInput;

    const plan = planList(query, MEDIA_SORTABLE, 'createdAt');

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({ where, ...plan, include: this.usageInclude() }),
      this.prisma.media.count({ where }),
    ]);

    return listResponse(query, rows.map((row) => this.toDto(row)), total);
  }

  async get(id: string): Promise<MediaDto> {
    const media = await this.prisma.media.findFirst({
      where: { id, deletedAt: null },
      include: this.usageInclude(),
    });
    if (!media) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That file does not exist' });
    }
    return this.toDto(media);
  }

  // --- write ----------------------------------------------------------------

  async patch(id: string, input: MediaPatchInput): Promise<MediaDto> {
    await this.get(id);
    if (input.folderId) await this.assertFolderExists(input.folderId);

    let posterKey: string | undefined;
    if (input.posterMediaId !== undefined) {
      if (input.posterMediaId === null) {
        posterKey = undefined;
      } else {
        const poster = await this.prisma.media.findFirst({
          where: { id: input.posterMediaId, kind: MediaKind.IMAGE, deletedAt: null },
          select: { storageKey: true },
        });
        if (!poster) {
          throw new BadRequestException({
            code: 'INVALID_POSTER',
            message: 'The poster must be an image from the library',
          });
        }
        posterKey = poster.storageKey;
      }
    }

    const media = await this.prisma.media.update({
      where: { id },
      data: {
        ...(input.alt === undefined ? {} : { alt: input.alt as never }),
        ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
        ...(input.posterMediaId === undefined ? {} : { posterKey: posterKey ?? null }),
      },
      include: this.usageInclude(),
    });

    return this.toDto(media);
  }

  /**
   * Soft-deletes a file that nothing references. Refusing rather than cascading is
   * deliberate: silently blanking a product's photo is worse than an error message.
   */
  async remove(id: string): Promise<void> {
    const media = await this.prisma.media.findFirst({
      where: { id, deletedAt: null },
      include: this.usageInclude(),
    });
    if (!media) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That file does not exist' });
    }

    const usage = countUsage(media);
    if (usage > 0) {
      throw new ConflictException({
        code: 'MEDIA_IN_USE',
        message: MEDIA_ERRORS.MEDIA_IN_USE,
        details: { usageCount: usage },
      });
    }

    // The row is kept so an audit entry still resolves; the bytes stay too, because a
    // checksum path may be shared with another row.
    await this.prisma.media.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async reprocess(id: string): Promise<MediaDto> {
    const media = await this.get(id);
    await this.prisma.media.update({
      where: { id },
      data: { processedAt: null, processingError: null },
    });
    await this.queue.processMedia(id);
    return { ...media, processedAt: null, processingError: null };
  }

  // --- folders --------------------------------------------------------------

  async listFolders(): Promise<MediaFolderDto[]> {
    const rows = await this.prisma.mediaFolder.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { media: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      mediaCount: row._count.media,
      position: row.position,
    }));
  }

  async createFolder(input: { name: string; parentId?: string | null }): Promise<MediaFolderDto> {
    if (input.parentId) await this.assertFolderExists(input.parentId);

    const parentId = input.parentId ?? null;

    // The `(parentId, name)` unique index does not cover the root: Postgres treats two
    // NULLs as distinct, so it would happily allow two top-level folders with the same
    // name — which is where most folders live. The check is done here instead.
    const clash = await this.prisma.mediaFolder.count({
      where: { parentId, name: input.name },
    });
    if (clash > 0) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'A folder with that name already exists here',
      });
    }

    const row = await this.prisma.mediaFolder.create({
      data: { name: input.name, parentId },
      include: { _count: { select: { media: true } } },
    });

    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      mediaCount: row._count.media,
      position: row.position,
    };
  }

  async removeFolder(id: string): Promise<void> {
    const folder = await this.prisma.mediaFolder.findUnique({
      where: { id },
      include: { _count: { select: { media: true, children: true } } },
    });
    if (!folder) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That folder does not exist' });
    }
    if (folder._count.media > 0 || folder._count.children > 0) {
      throw new ConflictException({
        code: 'FOLDER_NOT_EMPTY',
        message: MEDIA_ERRORS.FOLDER_NOT_EMPTY,
      });
    }
    await this.prisma.mediaFolder.delete({ where: { id } });
  }

  // --- internals ------------------------------------------------------------

  private async assertFolderExists(id: string): Promise<void> {
    const exists = await this.prisma.mediaFolder.count({ where: { id } });
    if (exists === 0) {
      throw new BadRequestException({
        code: 'INVALID_FOLDER',
        message: 'That folder does not exist',
      });
    }
  }

  /** Counting each relation is how "used by 4 products" stays honest. */
  private usageInclude() {
    return {
      _count: {
        select: Object.fromEntries(USAGE_RELATIONS.map((relation) => [relation, true])) as Record<
          (typeof USAGE_RELATIONS)[number],
          true
        >,
      },
    };
  }

  private unusedFilter(): Prisma.MediaWhereInput {
    return {
      AND: USAGE_RELATIONS.map((relation) => ({ [relation]: { none: {} } })) as never,
    };
  }

  private toDto(media: MediaWithCounts): MediaDto {
    return {
      id: media.id,
      kind: media.kind,
      fileName: media.fileName,
      mimeType: media.mimeType,
      storageKey: media.storageKey,
      url: this.storage.publicUrl(media.storageKey) ?? '',
      posterKey: media.posterKey,
      posterUrl: this.storage.publicUrl(media.posterKey),
      sizeBytes: media.sizeBytes,
      originalSizeBytes: media.originalSizeBytes,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      renditions: (media.renditions as Rendition[] | null) ?? [],
      placeholderColor: media.blurhash,
      alt: (media.alt as Record<string, string> | null) ?? null,
      folderId: media.folderId,
      usageCount: countUsage(media),
      processedAt: media.processedAt?.toISOString() ?? null,
      processingError: media.processingError,
      createdAt: media.createdAt.toISOString(),
    };
  }
}

type MediaWithCounts = {
  id: string;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  storageKey: string;
  posterKey: string | null;
  sizeBytes: number;
  originalSizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  renditions: unknown;
  blurhash: string | null;
  alt: unknown;
  folderId: string | null;
  processedAt: Date | null;
  processingError: string | null;
  createdAt: Date;
  _count: Record<string, number>;
};

function countUsage(media: { _count: Record<string, number> }): number {
  return USAGE_RELATIONS.reduce((sum, relation) => sum + (media._count[relation] ?? 0), 0);
}

/** SVG carries no renditions and PDFs none either; only rasters and models need work. */
function needsProcessing(kind: MediaKind, mimeType: string): boolean {
  if (kind === MediaKind.MODEL_3D) return true;
  if (kind !== MediaKind.IMAGE) return false;
  return mimeType !== 'image/svg+xml';
}

/**
 * Keeps a readable display name without letting it influence the storage path — the
 * path is derived from the checksum, so traversal and collisions are impossible.
 */
function sanitizeFileName(original: string, extension: string): string {
  const base = original
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 200);
  return `${base || 'fichier'}.${extension}`;
}

export const __mediaInternals = { sanitizeFileName, needsProcessing, countUsage };
