import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StorageError,
  contentTypeFor,
  createStorage,
  safeKey,
  storageConfigFromEnv,
  type StorageProvider,
} from './index.js';

describe('safeKey', () => {
  it('leaves a normal key alone', () => {
    expect(safeKey('media/ab/cd/file.jpg')).toBe('media/ab/cd/file.jpg');
  });

  it('strips a leading slash, so a key cannot become an absolute path', () => {
    expect(safeKey('/etc/passwd')).toBe('etc/passwd');
  });

  it('refuses traversal', () => {
    expect(() => safeKey('../../.env')).toThrow(StorageError);
    expect(() => safeKey('media/../../secret')).toThrow(StorageError);
  });

  it('normalizes Windows separators to the storage form', () => {
    expect(safeKey('media\\ab\\cd.jpg')).toBe('media/ab/cd.jpg');
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['a/b/c.webp', 'image/webp'],
    ['a.avif', 'image/avif'],
    ['model.glb', 'model/gltf-binary'],
    ['invoice.pdf', 'application/pdf'],
    ['clip.mp4', 'video/mp4'],
  ])('maps %s', (key, expected) => {
    expect(contentTypeFor(key)).toBe(expected);
  });

  it('falls back for an unknown extension rather than guessing', () => {
    expect(contentTypeFor('mystery.xyz')).toBe('application/octet-stream');
    expect(contentTypeFor('no-extension')).toBe('application/octet-stream');
  });
});

describe('local driver', () => {
  let root: string;
  let storage: StorageProvider;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'jecks-storage-'));
    storage = createStorage({
      driver: 'local',
      localDir: root,
      localBaseUrl: 'http://localhost:4000/api/v1',
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes and reads a key, creating directories as needed', async () => {
    await storage.put('media/ab/cd/file.txt', Buffer.from('hello'));
    expect((await storage.get('media/ab/cd/file.txt')).toString()).toBe('hello');
    expect((await readFile(join(root, 'media/ab/cd/file.txt'))).toString()).toBe('hello');
  });

  it('reports existence', async () => {
    await storage.put('present.txt', Buffer.from('x'));
    expect(await storage.exists('present.txt')).toBe(true);
    expect(await storage.exists('absent.txt')).toBe(false);
  });

  it('raises NOT_FOUND for a missing key, so callers can tell it from a real failure', async () => {
    await expect(storage.get('nope.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removes a key, and removing a missing one is not an error', async () => {
    await storage.put('gone.txt', Buffer.from('x'));
    await storage.remove('gone.txt');
    expect(await storage.exists('gone.txt')).toBe(false);
    await expect(storage.remove('gone.txt')).resolves.toBeUndefined();
  });

  it('refuses to read outside the media root', async () => {
    await expect(storage.get('../../../etc/passwd')).rejects.toThrow();
  });

  it('builds a public URL through the API media route', () => {
    expect(storage.publicUrl('media/a/b.jpg')).toBe(
      'http://localhost:4000/api/v1/media/media/a/b.jpg',
    );
  });

  it('passes an absolute URL through untouched', () => {
    expect(storage.publicUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });

  it('returns null for no key', () => {
    expect(storage.publicUrl(null)).toBeNull();
    expect(storage.publicUrl(undefined)).toBeNull();
  });
});

describe('s3 driver', () => {
  const config = {
    driver: 's3' as const,
    endpoint: 'http://localhost:9002',
    bucket: 'jecks-media',
    accessKey: 'key',
    secretKey: 'secret',
  };

  it('serves URLs from the bucket when no CDN is configured', () => {
    const storage = createStorage(config);
    expect(storage.publicUrl('media/a.jpg')).toBe('http://localhost:9002/jecks-media/media/a.jpg');
  });

  it('prefers the CDN origin when one is set', () => {
    const storage = createStorage({ ...config, publicUrl: 'https://cdn.jecks.dz/' });
    expect(storage.publicUrl('media/a.jpg')).toBe('https://cdn.jecks.dz/media/a.jpg');
  });

  it('refuses to start without credentials rather than failing on first write', () => {
    expect(() => createStorage({ ...config, accessKey: undefined })).toThrow(/S3_ACCESS_KEY/);
    expect(() => createStorage({ ...config, bucket: undefined })).toThrow(/S3_BUCKET/);
  });
});

describe('storageConfigFromEnv', () => {
  it('defaults to the local driver', () => {
    expect(storageConfigFromEnv({}).driver).toBe('local');
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 'anything' }).driver).toBe('local');
    expect(storageConfigFromEnv({ STORAGE_DRIVER: 's3' }).driver).toBe('s3');
  });

  it('resolves a relative media directory to an absolute path', () => {
    // The API and the worker run from different directories; a relative path resolved
    // against the current one would give them two different media roots.
    const { localDir } = storageConfigFromEnv({ LOCAL_STORAGE_DIR: './storage' });
    expect(localDir).toMatch(/[/\\]storage$/);
    expect(localDir?.startsWith('.')).toBe(false);
  });

  it('leaves an absolute path as given', () => {
    const posix = storageConfigFromEnv({ LOCAL_STORAGE_DIR: '/var/jecks/media' });
    expect(posix.localDir).toBe('/var/jecks/media');

    const windows = storageConfigFromEnv({ LOCAL_STORAGE_DIR: 'D:\\media' });
    expect(windows.localDir).toBe('D:\\media');
  });
});
