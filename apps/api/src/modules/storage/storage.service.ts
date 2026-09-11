import type { Readable } from 'node:stream';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageError,
  contentTypeFor,
  createStorage,
  storageConfigFromEnv,
  type StorageProvider,
} from '@jecks/storage';
import type { Env } from '../../config/env.js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
  sizeBytes: number;
}

/**
 * Nest-facing wrapper around the shared `StorageProvider` (PRD Section 10.3).
 *
 * The driver itself lives in `@jecks/storage` because the worker needs exactly the same
 * one: when the API wrote to disk and the worker read from S3, every upload processed
 * into a 404.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: StorageProvider;

  constructor(private readonly config: ConfigService<Env, true>) {
    // Read from the environment through the same helper the worker uses, so the two
    // processes cannot disagree about where the media lives.
    this.provider = createStorage(storageConfigFromEnv());

    this.logger.log(`Storage driver: ${this.provider.driver}`);
  }

  get driver(): 'local' | 's3' {
    return this.provider.driver;
  }

  publicUrl(key: string | null | undefined): string | null {
    return this.provider.publicUrl(key);
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.provider.put(key, body, contentTypeFor(key));
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const body = await this.provider.get(key);
      return { body, contentType: contentTypeFor(key), sizeBytes: body.length };
    } catch (error) {
      if (error instanceof StorageError && error.code !== 'UPSTREAM') {
        throw new NotFoundException({
          code: 'MEDIA_NOT_FOUND',
          message: 'That file does not exist',
        });
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  async remove(key: string): Promise<void> {
    await this.provider.remove(key);
  }
}

/** Kept for the media route, which streams rather than buffering where it can. */
export type { Readable };
