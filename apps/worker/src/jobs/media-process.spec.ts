import type { PrismaClient } from '@jecks/db';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processMedia, type MediaStorage } from './media-process.js';

/**
 * Runs the real sharp pipeline against a real generated image, with the database and
 * the object store stubbed. Mocking sharp would test nothing that matters here: the
 * point of this job is that it produces correctly sized, correctly encoded files.
 */

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 217, g: 179, b: 106 } },
  })
    .jpeg()
    .toBuffer();
}

function harness(row: Record<string, unknown> | null, source?: Buffer) {
  const written = new Map<string, Buffer>();
  const updates: Array<Record<string, unknown>> = [];

  const storage: MediaStorage = {
    get: vi.fn().mockImplementation(() => {
      if (!source) return Promise.reject(new Error('No object'));
      return Promise.resolve(source);
    }),
    put: vi.fn().mockImplementation((key: string, body: Buffer) => {
      written.set(key, body);
      return Promise.resolve();
    }),
  };

  const prisma = {
    media: {
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({});
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, storage, written, updates };
}

const imageRow = {
  id: 'media-1',
  kind: 'IMAGE',
  storageKey: 'media/ab/cd/abcd.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 100_000,
};

describe('processMedia — images', () => {
  beforeEach(() => vi.clearAllMocks());

  it('produces three widths in two formats', async () => {
    const { prisma, storage, written } = harness(imageRow, await jpeg(2400, 3000));

    const result = await processMedia(prisma, storage, 'media-1');

    expect(result.renditions).toBe(6);
    expect([...written.keys()].sort()).toEqual([
      'media/ab/cd/abcd/card.avif',
      'media/ab/cd/abcd/card.webp',
      'media/ab/cd/abcd/thumb.avif',
      'media/ab/cd/abcd/thumb.webp',
      'media/ab/cd/abcd/zoom.avif',
      'media/ab/cd/abcd/zoom.webp',
    ]);
  });

  it('encodes each rendition in the format its name promises', async () => {
    const { prisma, storage, written } = harness(imageRow, await jpeg(1200, 1200));
    await processMedia(prisma, storage, 'media-1');

    const webp = await sharp(written.get('media/ab/cd/abcd/card.webp')!).metadata();
    const avif = await sharp(written.get('media/ab/cd/abcd/card.avif')!).metadata();

    expect(webp.format).toBe('webp');
    expect(avif.format).toBe('heif'); // sharp reports AVIF as its HEIF container
  });

  it('resizes to the declared widths and keeps the aspect ratio', async () => {
    const { prisma, storage, written } = harness(imageRow, await jpeg(2400, 3000));
    await processMedia(prisma, storage, 'media-1');

    const thumb = await sharp(written.get('media/ab/cd/abcd/thumb.webp')!).metadata();
    expect(thumb.width).toBe(200);
    expect(thumb.height).toBe(250);
  });

  it('never upscales a small source', async () => {
    // A 300 px logo rendered at 1600 px is bytes spent on blur.
    const { prisma, storage, written } = harness(imageRow, await jpeg(300, 300));
    await processMedia(prisma, storage, 'media-1');

    const zoom = await sharp(written.get('media/ab/cd/abcd/zoom.webp')!).metadata();
    expect(zoom.width).toBe(300);
  });

  it('records the source dimensions and a placeholder colour', async () => {
    const { prisma, storage, updates } = harness(imageRow, await jpeg(2400, 3000));
    await processMedia(prisma, storage, 'media-1');

    const written = updates.find((update) => 'renditions' in update);
    expect(written).toMatchObject({ width: 2400, height: 3000 });
    expect(written?.blurhash).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('marks the row processed and clears any previous error', async () => {
    const { prisma, storage, updates } = harness(imageRow, await jpeg(600, 600));
    await processMedia(prisma, storage, 'media-1');

    expect(updates.at(-1)).toMatchObject({ processingError: null });
    expect(updates.at(-1)?.processedAt).toBeInstanceOf(Date);
  });

  it('skips renditions for a vector image', async () => {
    const { prisma, storage, written } = harness(
      { ...imageRow, mimeType: 'image/svg+xml' },
      Buffer.from('<svg/>'),
    );

    const result = await processMedia(prisma, storage, 'media-1');

    expect(result.renditions).toBe(0);
    expect(result.skipped).toContain('vector');
    expect(written.size).toBe(0);
  });
});

describe('processMedia — failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when the media row is gone', async () => {
    const { prisma, storage } = harness(null);
    await expect(processMedia(prisma, storage, 'missing')).rejects.toThrow(/does not exist/);
  });

  it('records the reason on the row, then rethrows so the queue retries', async () => {
    // No source buffer: the storage stub rejects, as it would for a missing object.
    const { prisma, storage, updates } = harness(imageRow);

    await expect(processMedia(prisma, storage, 'media-1')).rejects.toThrow();

    expect(updates.at(-1)).toMatchObject({ processingError: expect.stringContaining('No object') });
    // The row must not be marked processed when it was not.
    expect(updates.some((update) => 'processedAt' in update)).toBe(false);
  });

  it('rejects a file sharp cannot read as an image', async () => {
    const { prisma, storage, updates } = harness(imageRow, Buffer.from('not an image at all'));

    await expect(processMedia(prisma, storage, 'media-1')).rejects.toThrow();
    expect(updates.at(-1)?.processingError).toBeTruthy();
  });

  it('truncates a very long failure message to fit the column', async () => {
    const { prisma, storage, updates } = harness(imageRow);
    (storage.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'.repeat(2000)));

    await expect(processMedia(prisma, storage, 'media-1')).rejects.toThrow();
    expect(String(updates.at(-1)?.processingError).length).toBeLessThanOrEqual(500);
  });
});
