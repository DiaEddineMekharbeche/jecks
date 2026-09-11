import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, RawResponse } from '../../common/decorators/auth.decorators.js';
import { DocumentLinksService } from './document-links.service.js';
import { StorageService } from './storage.service.js';

@ApiTags('media')
@Controller('media')
export class MediaFileController {
  constructor(private readonly storage: StorageService) {}

  /**
   * Serves a stored object in development, where the local driver has no CDN in front
   * of it. In production S3_PUBLIC_URL points the storefront straight at the bucket and
   * this route sees no traffic.
   */
  @Public()
  @RawResponse()
  // Keys are content-addressed, so a given key always holds the same bytes.
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Get(':key(*)')
  @ApiOperation({ summary: 'Stream a stored media file by key' })
  async serve(@Param('key') key: string | string[], @Res() response: Response): Promise<void> {
    const path = Array.isArray(key) ? key.join('/') : key;
    const object = await this.storage.get(path);
    response.setHeader('Content-Type', object.contentType);
    response.setHeader('Content-Length', object.sizeBytes);
    // SVG is stored but never executed: without this an uploaded SVG could run script
    // on the API's origin.
    if (object.contentType === 'image/svg+xml') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    }
    response.end(object.body);
  }
}

/**
 * Documents behind a signed link — PRD Section 10.8.
 *
 * Labels, manifests, backups and exports. Separate from the media route because these
 * are private by default: the token is what authorises the read, and the response is
 * explicitly not cacheable by anything in between.
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentController {
  constructor(
    private readonly storage: StorageService,
    private readonly links: DocumentLinksService,
  ) {}

  @Public()
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  @Get(':token')
  @ApiOperation({ summary: 'Download a document with a short-lived signed token' })
  async download(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const key = this.links.verify(token);
    const object = await this.storage.get(key);

    response.setHeader('Content-Type', object.contentType);
    response.setHeader('Content-Length', object.sizeBytes);
    // Always an attachment: a PDF rendered inline on the API origin is script the
    // browser runs there.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${key.split('/').pop() ?? 'document'}"`,
    );
    response.end(object.body);
  }
}
