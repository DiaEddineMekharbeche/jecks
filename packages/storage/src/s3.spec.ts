import { afterAll, describe, expect, it } from 'vitest';
import { StorageError, createStorage } from './index.js';

/**
 * The S3 driver, against a stubbed `fetch`.
 *
 * The SigV4 signature is written here rather than taken from the AWS SDK, and a wrong
 * canonical request fails the same way every time: every upload returns 403 in
 * production and never in development, where the local driver is used. So the request
 * this builds is asserted on directly, byte for byte where it matters.
 */

const CONFIG = {
  driver: 's3' as const,
  endpoint: 'https://s3.test',
  bucket: 'jecks-media',
  region: 'eu-west-3',
  accessKey: 'AKIAEXAMPLE',
  secretKey: 'shhh',
};

interface Call {
  url: string;
  init: RequestInit;
}

const original = globalThis.fetch;
let calls: Call[] = [];

/** Replaces `fetch` and records what the driver tried to send. */
function stub(options: { status?: number; body?: string } = {}): void {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const status = options.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      text: async () => options.body ?? '',
    } as Response;
  }) as unknown as typeof fetch;
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

afterAll(() => {
  globalThis.fetch = original;
});

describe('S3 driver — configuration', () => {
  it('refuses to start without credentials, rather than 403ing at the first upload', () => {
    expect(() => createStorage({ ...CONFIG, accessKey: undefined })).toThrow(/S3_ACCESS_KEY/);
    expect(() => createStorage({ ...CONFIG, secretKey: undefined })).toThrow(/S3_SECRET_KEY/);
    expect(() => createStorage({ ...CONFIG, bucket: undefined })).toThrow(/S3_BUCKET/);
    expect(() => createStorage({ ...CONFIG, endpoint: undefined })).toThrow(/S3_ENDPOINT/);
  });

  it('reports itself as the s3 driver', () => {
    expect(createStorage(CONFIG).driver).toBe('s3');
  });

  it('tolerates a trailing slash on the endpoint', async () => {
    stub();
    await createStorage({ ...CONFIG, endpoint: 'https://s3.test/' }).put(
      'media/a.jpg',
      Buffer.from('x'),
    );

    expect(calls[0]?.url).toBe('https://s3.test/jecks-media/media/a.jpg');
  });
});

describe('S3 driver — signing', () => {
  it('signs a PUT with the SigV4 headers and the payload hash', async () => {
    stub();

    await createStorage(CONFIG).put('media/ab/cd.jpg', Buffer.from('hello'), 'image/jpeg');

    const call = calls[0]!;
    const headers = headersOf(call);

    expect(call.url).toBe('https://s3.test/jecks-media/media/ab/cd.jpg');
    expect(call.init.method).toBe('PUT');
    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/');
    // The scope carries the region; a mismatch here is the commonest signing error.
    expect(headers.Authorization).toContain('/eu-west-3/s3/aws4_request');
    expect(headers.Authorization).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
    );
    expect(headers.Authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    // SHA-256 of "hello": S3 recomputes this and refuses anything else.
    expect(headers['x-amz-content-sha256']).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['Content-Type']).toBe('image/jpeg');
  });

  it('hashes the empty body for a request that carries none', async () => {
    stub();

    await createStorage(CONFIG).exists('media/x.jpg');

    // The published SHA-256 of the empty string.
    expect(headersOf(calls[0]!)['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('omits the content type when the caller gave none', async () => {
    stub();

    await createStorage(CONFIG).put('media/a.bin', Buffer.from('x'));

    expect(headersOf(calls[0]!)['Content-Type']).toBeUndefined();
  });

  it('signs different payloads differently', async () => {
    stub();
    const storage = createStorage(CONFIG);

    await storage.put('media/a.jpg', Buffer.from('one'));
    await storage.put('media/a.jpg', Buffer.from('two'));

    expect(headersOf(calls[0]!)['x-amz-content-sha256']).not.toBe(
      headersOf(calls[1]!)['x-amz-content-sha256'],
    );
  });
});

describe('S3 driver — verbs', () => {
  it('reads an object back as a buffer', async () => {
    stub();

    const body = await createStorage(CONFIG).get('media/a.jpg');

    expect(Buffer.isBuffer(body)).toBe(true);
    expect([...body]).toEqual([1, 2, 3]);
  });

  it('tells a missing object apart from a broken bucket', async () => {
    stub({ status: 404 });
    await expect(createStorage(CONFIG).get('media/gone.jpg')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    stub({ status: 500 });
    await expect(createStorage(CONFIG).get('media/a.jpg')).rejects.toMatchObject({
      code: 'UPSTREAM',
    });
  });

  it('reports a refused write rather than returning quietly', async () => {
    stub({ status: 403 });

    await expect(
      createStorage(CONFIG).put('media/a.jpg', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('answers false for a missing object without throwing', async () => {
    stub({ status: 404 });

    await expect(createStorage(CONFIG).exists('media/gone.jpg')).resolves.toBe(false);
  });

  it('answers true for one that is there', async () => {
    stub();

    await expect(createStorage(CONFIG).exists('media/a.jpg')).resolves.toBe(true);
    expect(calls[0]?.init.method).toBe('HEAD');
  });

  it('deletes without caring what the bucket answers', async () => {
    stub({ status: 204 });

    await expect(createStorage(CONFIG).remove('media/a.jpg')).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe('DELETE');
  });
});

describe('S3 driver — listing', () => {
  it('lists one page and decodes the escaped keys', async () => {
    stub({
      body: `<?xml version="1.0"?><ListBucketResult>
        <Contents><Key>backups/a.dump</Key></Contents>
        <Contents><Key>backups/caf&amp;e.dump</Key></Contents>
      </ListBucketResult>`,
    });

    const keys = await createStorage(CONFIG).list('backups/');

    expect(keys).toEqual(['backups/a.dump', 'backups/caf&e.dump']);
    expect(calls[0]?.url).toContain('list-type=2');
    expect(calls[0]?.url).toContain('prefix=backups');
  });

  it('returns nothing for an empty listing rather than failing to parse', async () => {
    stub({ body: '<ListBucketResult></ListBucketResult>' });

    await expect(createStorage(CONFIG).list('backups/')).resolves.toEqual([]);
  });

  it('reports a failed listing, because a retention job must not read it as empty', async () => {
    // Silently returning [] here would make the backup pruner believe there is nothing
    // to keep, which is the worst possible moment to be wrong.
    stub({ status: 500 });

    await expect(createStorage(CONFIG).list('backups/')).rejects.toMatchObject({
      code: 'UPSTREAM',
    });
  });
});

describe('S3 driver — public URLs', () => {
  it('builds one from the bucket when there is no CDN', () => {
    expect(createStorage(CONFIG).publicUrl('media/a.jpg')).toBe(
      'https://s3.test/jecks-media/media/a.jpg',
    );
  });

  it('prefers the CDN, without doubling its trailing slash', () => {
    const behindCdn = createStorage({ ...CONFIG, publicUrl: 'https://cdn.jecks.dz/' });

    expect(behindCdn.publicUrl('media/a.jpg')).toBe('https://cdn.jecks.dz/media/a.jpg');
  });

  it('passes an absolute URL through, and answers null for nothing', () => {
    const storage = createStorage(CONFIG);

    expect(storage.publicUrl('https://elsewhere.test/a.jpg')).toBe('https://elsewhere.test/a.jpg');
    expect(storage.publicUrl(null)).toBeNull();
    expect(storage.publicUrl(undefined)).toBeNull();
    expect(storage.publicUrl('')).toBeNull();
  });
});

describe('S3 driver — key safety', () => {
  it('refuses a traversing key before it reaches the network', async () => {
    stub();

    await expect(
      createStorage(CONFIG).put('../../etc/passwd', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageError);
    expect(calls).toHaveLength(0);
  });

  it('strips a leading slash rather than producing a double one in the URL', async () => {
    stub();

    await createStorage(CONFIG).put('/media/a.jpg', Buffer.from('x'));

    expect(calls[0]?.url).toBe('https://s3.test/jecks-media/media/a.jpg');
  });
});
