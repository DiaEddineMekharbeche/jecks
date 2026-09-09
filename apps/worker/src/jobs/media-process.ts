import type { PrismaClient } from '@jecks/db';
import {
  MediaKind,
  RENDITION_FORMATS,
  RENDITION_WIDTHS,
  type Rendition,
  type RenditionFormat,
  type RenditionName,
} from '@jecks/shared';
import sharp from 'sharp';

/**
 * Media processing — PRD Section 6.3 and PRD-COMPLETION M1.1.
 *
 * Images get three widths in WebP and AVIF. 3D models get Draco compression and, when
 * the file carries one, an extracted poster. The storage driver is injected rather than
 * imported so the same processor works against local disk in development and S3 in
 * production, and so the unit tests need neither.
 */

export interface MediaStorage {
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer): Promise<void>;
}

export interface ProcessResult {
  mediaId: string;
  renditions: number;
  width?: number;
  height?: number;
  posterKey?: string | null;
  sizeBytes?: number;
  originalSizeBytes?: number;
  skipped?: string;
}

/** Anything wider than this is downscaled: nobody needs a 6000 px product photo. */
const MAX_SOURCE_WIDTH = 4000;

export async function processMedia(
  prisma: PrismaClient,
  storage: MediaStorage,
  mediaId: string,
): Promise<ProcessResult> {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, kind: true, storageKey: true, mimeType: true, sizeBytes: true },
  });

  if (!media) throw new Error(`Media ${mediaId} does not exist`);

  try {
    const result =
      media.kind === MediaKind.MODEL_3D
        ? await processModel(prisma, storage, media)
        : await processImage(prisma, storage, media);

    await prisma.media.update({
      where: { id: mediaId },
      data: { processedAt: new Date(), processingError: null },
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The failure is recorded on the row so the library can show it and offer a retry,
    // then rethrown so BullMQ counts the attempt and backs off.
    await prisma.media.update({
      where: { id: mediaId },
      data: { processingError: message.slice(0, 500) },
    });
    throw error;
  }
}

// --- images -----------------------------------------------------------------

async function processImage(
  prisma: PrismaClient,
  storage: MediaStorage,
  media: { id: string; storageKey: string; mimeType: string },
): Promise<ProcessResult> {
  if (media.mimeType === 'image/svg+xml') {
    return { mediaId: media.id, renditions: 0, skipped: 'vector image needs no renditions' };
  }

  const source = await storage.get(media.storageKey);
  // `failOn: 'none'` keeps a slightly malformed but displayable photo from failing the
  // whole upload; a genuinely broken file still throws on metadata().
  const image = sharp(source, { failOn: 'none' });
  const metadata = await image.metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) throw new Error('Could not read the image dimensions');

  const renditions: Rendition[] = [];
  const base = media.storageKey.replace(/\.[^./]+$/, '');

  for (const [name, targetWidth] of Object.entries(RENDITION_WIDTHS) as Array<
    [RenditionName, number]
  >) {
    // Never upscale: a 300 px logo rendered at 1600 px is bytes spent on blur.
    const renditionWidth = Math.min(targetWidth, width, MAX_SOURCE_WIDTH);

    for (const format of RENDITION_FORMATS) {
      const pipeline = sharp(source, { failOn: 'none' })
        .rotate() // Applies the EXIF orientation, then strips it with the metadata.
        .resize({ width: renditionWidth, withoutEnlargement: true });

      const buffer = await encode(pipeline, format);
      const produced = await sharp(buffer).metadata();
      const key = `${base}/${name}.${format}`;

      await storage.put(key, buffer);
      renditions.push({
        name,
        format,
        width: produced.width ?? renditionWidth,
        height: produced.height ?? Math.round((renditionWidth / width) * height),
        key,
        sizeBytes: buffer.length,
      });
    }
  }

  const blurhash = await makePlaceholder(source);

  await prisma.media.update({
    where: { id: media.id },
    data: { width, height, renditions: renditions as never, blurhash },
  });

  return { mediaId: media.id, renditions: renditions.length, width, height };
}

function encode(pipeline: sharp.Sharp, format: RenditionFormat): Promise<Buffer> {
  return format === 'avif'
    ? // AVIF at effort 4 is a deliberate compromise: effort 9 is roughly ten times
      // slower for a few percent of size, which is the wrong trade in a queue.
      pipeline.avif({ quality: 55, effort: 4 }).toBuffer()
    : pipeline.webp({ quality: 78, effort: 4 }).toBuffer();
}

/**
 * Dominant colour as a hex string, used as the background of an image placeholder so a
 * card shows roughly the right colour before the photo arrives instead of a grey box.
 *
 * A real BlurHash would be prettier, but it needs another dependency and a decoder on
 * both frontends; seven characters that already fit the column buy most of the benefit.
 */
async function makePlaceholder(source: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(source, { failOn: 'none' }).stats();
    const hex = [dominant.r, dominant.g, dominant.b]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  } catch {
    return null;
  }
}

// --- 3D models ---------------------------------------------------------------

/**
 * Draco-compresses a GLB and extracts a poster when the file embeds one.
 *
 * Rendering a poster from geometry would need a GL context in Node — headless-gl or a
 * browser — which is a heavy native dependency for one thumbnail. Instead: a poster
 * embedded in the model is used, and otherwise the admin assigns one from the media
 * library (`PATCH /admin/media/:id` with `posterMediaId`). The storefront falls back to
 * a generated placeholder until then. See DECISIONS D31.
 */
async function processModel(
  prisma: PrismaClient,
  storage: MediaStorage,
  media: { id: string; storageKey: string; sizeBytes: number },
): Promise<ProcessResult> {
  const source = await storage.get(media.storageKey);

  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { draco, dedup, prune, textureCompress } = await import('@gltf-transform/functions');
  const draco3d = await import('draco3dgltf');

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const document = await io.readBinary(new Uint8Array(source));

  // Order matters: dedup and prune first so Draco is not asked to compress geometry
  // that is about to be thrown away.
  await document.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }),
    draco({ method: 'edgebreaker' }),
  );

  const compressed = Buffer.from(await io.writeBinary(document));
  const optimizedKey = media.storageKey.replace(/\.glb$/i, '.optimized.glb');
  await storage.put(optimizedKey, compressed);

  // A model that already carries a texture can use its first one as the poster.
  const posterKey = await extractPoster(document, storage, media.storageKey);

  const root = document.getRoot();
  const meshes = root.listMeshes().length;

  await prisma.media.update({
    where: { id: media.id },
    data: {
      storageKey: optimizedKey,
      sizeBytes: compressed.length,
      originalSizeBytes: media.sizeBytes,
      posterKey,
      renditions: [
        {
          name: 'zoom',
          format: 'webp',
          width: 0,
          height: 0,
          key: optimizedKey,
          sizeBytes: compressed.length,
        },
      ] as never,
      alt: undefined,
      durationMs: null,
      width: meshes,
    },
  });

  return {
    mediaId: media.id,
    renditions: 0,
    posterKey,
    sizeBytes: compressed.length,
    originalSizeBytes: media.sizeBytes,
  };
}

async function extractPoster(
  document: { getRoot(): { listTextures(): Array<{ getImage(): Uint8Array | null }> } },
  storage: MediaStorage,
  storageKey: string,
): Promise<string | null> {
  const texture = document.getRoot().listTextures()[0];
  const image = texture?.getImage();
  if (!image) return null;

  try {
    const poster = await sharp(Buffer.from(image))
      .resize({ width: 600, height: 600, fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    const key = `${storageKey.replace(/\.[^./]+$/, '')}/poster.webp`;
    await storage.put(key, poster);
    return key;
  } catch {
    // A texture we cannot decode is not a reason to fail the whole model.
    return null;
  }
}

export const __mediaProcessInternals = { makePlaceholder, encode };
