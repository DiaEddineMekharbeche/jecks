import { createHash, createHmac } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';

/**
 * `StorageProvider` of PRD Sections 6.3 and 10.3.
 *
 * One implementation shared by the API and the worker. They read and write the same
 * keys, so a driver that only half-existed in one of them — as the S3 branch did — is
 * a silent data loss: the API writes to disk, the worker looks in the bucket, and the
 * file is simply not there.
 */

export interface StorageProvider {
  readonly driver: 'local' | 's3';
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /**
   * Keys under a prefix, newest-first order not guaranteed. Used by retention jobs;
   * callers must not rely on it to enumerate the whole bucket.
   */
  list(prefix: string): Promise<string[]>;
  /** Browser-facing URL, or null when the key is null. */
  publicUrl(key: string | null | undefined): string | null;
}

export interface StorageConfig {
  driver: 'local' | 's3';
  /** Local driver: absolute path to the media root. */
  localDir?: string;
  /** Serves local files when there is no CDN, e.g. `http://localhost:4000/api/v1`. */
  localBaseUrl?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
  publicUrl?: string;
}

export function createStorage(config: StorageConfig): StorageProvider {
  return config.driver === 's3' ? new S3Storage(config) : new LocalStorage(config);
}

/**
 * Rejects any key that would escape the media root. Keys come from the database, but a
 * route can take one from a URL, so the check belongs in the provider rather than in
 * each caller.
 */
export function safeKey(key: string): string {
  const cleaned = normalize(key).replace(/\\/g, '/').replace(/^\/+/, '');

  // Rejecting rather than stripping: a key that tried to climb out is either a bug or
  // an attack, and quietly rewriting it into a different valid key hides both.
  if (cleaned.split('/').includes('..')) {
    throw new StorageError('INVALID_KEY', `Refusing key ${key}`);
  }
  return cleaned;
}

export class StorageError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_KEY' | 'UPSTREAM',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// --- local -------------------------------------------------------------------

class LocalStorage implements StorageProvider {
  readonly driver = 'local' as const;
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(config: StorageConfig) {
    this.root = resolve(config.localDir ?? './storage');
    this.baseUrl = (config.localBaseUrl ?? '').replace(/\/$/, '');
  }

  private path(key: string): string {
    const path = join(this.root, safeKey(key));
    if (!path.startsWith(this.root + sep)) {
      throw new StorageError('INVALID_KEY', `Refusing key ${key}`);
    }
    return path;
  }

  async get(key: string): Promise<Buffer> {
    const path = this.path(key);
    if (!existsSync(path)) throw new StorageError('NOT_FOUND', `No object at ${key}`);
    return readFile(path);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch {
      // Already gone is the desired end state.
    }
  }

  async list(prefix: string): Promise<string[]> {
    const cleaned = safeKey(prefix);
    // A prefix that names a directory is the only shape callers use; walking the whole
    // root to emulate S3's arbitrary string prefix would be slow and is never needed.
    const directory = join(this.root, cleaned);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const base = cleaned.replace(/\/+$/, '');
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => (base ? `${base}/${entry.name}` : entry.name));
    } catch {
      return [];
    }
  }

  publicUrl(key: string | null | undefined): string | null {
    if (!key) return null;
    if (key.startsWith('http')) return key;
    return `${this.baseUrl}/media/${safeKey(key)}`;
  }
}

// --- s3 ----------------------------------------------------------------------

/**
 * S3-compatible driver over plain fetch with SigV4.
 *
 * The AWS SDK would add several megabytes to two container images for four verbs
 * against MinIO or R2. Signing is about sixty lines and has no dependencies.
 */
class S3Storage implements StorageProvider {
  readonly driver = 's3' as const;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly cdn: string | null;

  constructor(config: StorageConfig) {
    this.endpoint = required(config.endpoint, 'S3_ENDPOINT').replace(/\/$/, '');
    this.bucket = required(config.bucket, 'S3_BUCKET');
    this.region = config.region ?? 'us-east-1';
    this.accessKey = required(config.accessKey, 'S3_ACCESS_KEY');
    this.secretKey = required(config.secretKey, 'S3_SECRET_KEY');
    this.cdn = config.publicUrl?.replace(/\/$/, '') ?? null;
  }

  private url(key: string): string {
    return `${this.endpoint}/${this.bucket}/${safeKey(key)}`;
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.signedFetch('GET', this.url(key));
    if (response.status === 404) throw new StorageError('NOT_FOUND', `No object at ${key}`);
    if (!response.ok) {
      throw new StorageError('UPSTREAM', `Could not read ${key}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    const response = await this.signedFetch('PUT', this.url(key), body, contentType);
    if (!response.ok) {
      throw new StorageError('UPSTREAM', `Could not write ${key}: ${response.status}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.signedFetch('HEAD', this.url(key));
    return response.ok;
  }

  async remove(key: string): Promise<void> {
    await this.signedFetch('DELETE', this.url(key));
  }

  /**
   * ListObjectsV2, one page. Retention jobs work on prefixes holding tens of objects,
   * and pretending to paginate an unbounded listing here would invite callers to use
   * it as a directory walk over the whole bucket.
   */
  async list(prefix: string): Promise<string[]> {
    const url = new URL(`${this.endpoint}/${this.bucket}`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', safeKey(prefix));
    url.searchParams.set('max-keys', '1000');

    const response = await this.signedFetch('GET', url.toString());
    if (!response.ok) {
      throw new StorageError('UPSTREAM', `Could not list ${prefix}: ${response.status}`);
    }

    const body = await response.text();
    return [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => decodeXml(match[1] ?? ''));
  }

  publicUrl(key: string | null | undefined): string | null {
    if (!key) return null;
    if (key.startsWith('http')) return key;
    return `${this.cdn ?? `${this.endpoint}/${this.bucket}`}/${safeKey(key)}`;
  }

  private signedFetch(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    target: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = new URL(target);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      method,
      // Each path segment is encoded, but the separators are not.
      url.pathname.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'),
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string): Buffer =>
      createHmac('sha256', key).update(data).digest();

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretKey}`, dateStamp), this.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return fetch(target, {
      method,
      body,
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
    });
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return value;
}

/**
 * Walks up from `from` looking for the workspace marker.
 *
 * The API runs from `apps/api` and the worker from `apps/worker`, so resolving a
 * relative `LOCAL_STORAGE_DIR` against the current directory gives each of them a
 * different media root — which is exactly the split-brain this package exists to
 * prevent. Anchoring on the workspace file makes both agree wherever they are started
 * from. In a container, where the marker is absent, the working directory is the root.
 */
export function findRepoRoot(from: string = process.cwd()): string {
  let current = resolve(from);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(from);
}

/** Reads the driver configuration out of `process.env`, the same way in both apps. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const configured = env.LOCAL_STORAGE_DIR ?? './storage';

  return {
    driver: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    localDir: isAbsolutePath(configured) ? configured : resolve(findRepoRoot(), configured),
    localBaseUrl: env.API_PUBLIC_URL,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    publicUrl: env.S3_PUBLIC_URL,
  };
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  pdf: 'application/pdf',
};

export function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/** The five entities S3 escapes in a key. Enough for object listings; not a parser. */
function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
