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

/**
 * 3D models run the real glTF pipeline against a real GLB, for the same reason the
 * image tests run the real sharp pipeline: the value of this job is the bytes it
 * produces, and a mocked encoder proves none of it.
 */
describe('processMedia — 3D models', () => {
  beforeEach(() => vi.clearAllMocks());

  const modelRow = (sizeBytes: number) => ({
    id: 'media-3d',
    kind: 'MODEL_3D',
    storageKey: 'media/ab/cd/cap.glb',
    mimeType: 'model/gltf-binary',
    sizeBytes,
  });

  it('reads a GLB, counts its meshes and marks it processed', async () => {
    const glb = buildPlaceholderGlb();
    const { prisma, storage, updates } = harness(modelRow(glb.length), glb);

    const result = await processMedia(prisma, storage, 'media-3d');

    expect(result.renditions).toBe(0);
    // One mesh in, one mesh out: dedup and prune must not eat the geometry.
    expect(updates[0]?.width).toBe(1);
    expect(updates.at(-1)?.processedAt).toBeInstanceOf(Date);
    expect(updates.at(-1)?.processingError).toBeNull();
  });

  it('keeps the original when Draco makes the file bigger', async () => {
    // A box has eight vertices; Draco's header costs more than it saves on one.
    const glb = buildPlaceholderGlb();
    const { prisma, storage, written, updates } = harness(modelRow(glb.length), glb);

    const result = await processMedia(prisma, storage, 'media-3d');

    expect(result.skipped).toContain('larger');
    expect(updates[0]?.storageKey).toBe('media/ab/cd/cap.glb');
    expect(updates[0]?.sizeBytes).toBe(glb.length);
    // Nothing was written, because there was nothing better to write.
    expect(written.has('media/ab/cd/cap.optimized.glb')).toBe(false);
  });

  it('has no poster to extract from a model with no textures', async () => {
    const glb = buildPlaceholderGlb();
    const { prisma, storage } = harness(modelRow(glb.length), glb);

    const result = await processMedia(prisma, storage, 'media-3d');

    // The admin assigns one from the library instead — DECISIONS D34.
    expect(result.posterKey).toBeNull();
  });

  it('records a failure on the row and rethrows for the queue to retry', async () => {
    const { prisma, storage, updates } = harness(modelRow(64), Buffer.from('not a glb'));

    await expect(processMedia(prisma, storage, 'media-3d')).rejects.toThrow();
    expect(updates.at(-1)?.processingError).toEqual(expect.any(String));
  });
});

/**
 * A minimal valid GLB: an indexed box with one PBR material and no textures. Built here
 * rather than checked in, so the fixture is reviewable.
 */
function buildPlaceholderGlb(): Buffer {
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5,
    0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 0, 4,
    5, 0, 5, 1,
  ]);

  const align = (value: number) => Math.ceil(value / 4) * 4;
  const positionBytes = Buffer.from(positions.buffer);
  const indexBytes = Buffer.from(indices.buffer);
  const indexOffset = align(positionBytes.length);
  const binary = Buffer.alloc(align(indexOffset + indexBytes.length));
  positionBytes.copy(binary, 0);
  indexBytes.copy(binary, indexOffset);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.7, 0.42, 1] } }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-0.5, 0, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: binary.length }],
  };

  const pad = (buffer: Buffer, fill: number) => {
    const padded = Buffer.alloc(align(buffer.length), fill);
    buffer.copy(padded, 0);
    return padded;
  };

  const json = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const bin = pad(binary, 0x00);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');

  return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
}
