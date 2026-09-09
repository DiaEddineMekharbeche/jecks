import { z } from 'zod';
import { MediaKind } from '../enums/index.js';
import { adminListQuerySchema } from './admin.js';
import { idSchema, translatedOptionalSchema } from './common.js';

/**
 * Media library contracts — PRD F-AD-10 (media) and Section 6.3.
 *
 * The limits and the accepted types live here rather than in the API alone, so the
 * upload control can reject a file before spending a minute uploading it.
 */

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** PRD Section 6.3: GLB ≤ 15 MB. */
export const MAX_MODEL_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'],
  VIDEO: ['video/mp4', 'video/webm'],
  MODEL_3D: ['model/gltf-binary'],
  DOCUMENT: ['application/pdf'],
} as const satisfies Record<MediaKind, readonly string[]>;

export const MAX_BYTES_BY_KIND: Record<MediaKind, number> = {
  IMAGE: MAX_IMAGE_BYTES,
  VIDEO: MAX_VIDEO_BYTES,
  MODEL_3D: MAX_MODEL_BYTES,
  DOCUMENT: MAX_DOCUMENT_BYTES,
};

/** Accept attribute for the file picker, so the OS dialog filters for us. */
export const UPLOAD_ACCEPT = [
  ...ACCEPTED_MIME_TYPES.IMAGE,
  ...ACCEPTED_MIME_TYPES.VIDEO,
  ...ACCEPTED_MIME_TYPES.DOCUMENT,
  '.glb',
].join(',');

/**
 * Responsive sizes generated for every raster image — PRD Section 6.3.
 * `thumb` for admin grids, `card` for product cards, `zoom` for the PDP gallery.
 */
export const RENDITION_WIDTHS = { thumb: 200, card: 600, zoom: 1600 } as const;
export type RenditionName = keyof typeof RENDITION_WIDTHS;
export const RENDITION_FORMATS = ['webp', 'avif'] as const;
export type RenditionFormat = (typeof RENDITION_FORMATS)[number];

export interface Rendition {
  name: RenditionName;
  format: RenditionFormat;
  width: number;
  height: number;
  key: string;
  sizeBytes: number;
}

/** Best rendition at or above the requested width, falling back to the original. */
export function pickRendition(
  renditions: Rendition[] | null | undefined,
  minWidth: number,
  format: RenditionFormat = 'webp',
): Rendition | null {
  if (!renditions || renditions.length === 0) return null;
  const candidates = renditions
    .filter((rendition) => rendition.format === format)
    .sort((a, b) => a.width - b.width);
  if (candidates.length === 0) return null;
  return candidates.find((rendition) => rendition.width >= minWidth) ?? candidates.at(-1) ?? null;
}

/** `srcset` string for an `<img>`, in the given format. */
export function buildSrcSet(
  renditions: Rendition[] | null | undefined,
  toUrl: (key: string) => string,
  format: RenditionFormat = 'webp',
): string | undefined {
  const entries = (renditions ?? [])
    .filter((rendition) => rendition.format === format)
    .sort((a, b) => a.width - b.width)
    .map((rendition) => `${toUrl(rendition.key)} ${rendition.width}w`);
  return entries.length > 0 ? entries.join(', ') : undefined;
}

// --- API contracts ----------------------------------------------------------

export const mediaListQuerySchema = adminListQuerySchema.extend({
  kind: z.nativeEnum(MediaKind).optional(),
  folderId: z.string().optional(),
  /** `true` returns only files nothing references, for a safe clean-up. */
  unusedOnly: z.coerce.boolean().optional(),
});

export const mediaPatchSchema = z.object({
  alt: translatedOptionalSchema.optional(),
  folderId: idSchema.nullable().optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  /** Assigns a poster image to a 3D model or a video. */
  posterMediaId: idSchema.nullable().optional(),
});

export const mediaFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: idSchema.nullable().optional(),
});

export const mediaUploadFieldsSchema = z.object({
  folderId: idSchema.optional(),
  alt: z.string().max(2000).optional(),
});

export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
export type MediaPatchInput = z.infer<typeof mediaPatchSchema>;
export type MediaFolderInput = z.infer<typeof mediaFolderInputSchema>;

export interface MediaDto {
  id: string;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  storageKey: string;
  url: string;
  posterKey: string | null;
  posterUrl: string | null;
  sizeBytes: number;
  originalSizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  renditions: Rendition[];
  /** Dominant colour as #RRGGBB, painted behind an image while it loads. */
  placeholderColor: string | null;
  alt: Record<string, string> | null;
  folderId: string | null;
  /** How many products, collections, banners and so on point at this file. */
  usageCount: number;
  processedAt: string | null;
  processingError: string | null;
  createdAt: string;
}

export interface MediaFolderDto {
  id: string;
  name: string;
  parentId: string | null;
  mediaCount: number;
  position: number;
}

export const MEDIA_ERRORS = {
  UNSUPPORTED_TYPE: 'That file type is not accepted',
  FILE_TOO_LARGE: 'That file is too large',
  CONTENT_MISMATCH: 'The file contents do not match its extension',
  MEDIA_IN_USE: 'That file is still used somewhere and cannot be deleted',
  FOLDER_NOT_EMPTY: 'Empty the folder before deleting it',
} as const;
