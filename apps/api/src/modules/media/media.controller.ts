import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MAX_VIDEO_BYTES,
  mediaFolderInputSchema,
  mediaListQuerySchema,
  mediaPatchSchema,
  type MediaFolderInput,
  type MediaListQuery,
  type MediaPatchInput,
} from '@jecks/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { AuditEntity } from '../../common/interceptors/audit.interceptor.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { MediaService } from './media.service.js';

/** Multer keeps the file in memory; the largest accepted kind sets the ceiling. */
const UPLOAD_LIMITS = { fileSize: MAX_VIDEO_BYTES, files: 20 };

@ApiTags('admin/media')
@ApiBearerAuth()
@AuditEntity('media')
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Media library, filtered by kind, folder, usage or name' })
  list(@Query(zod(mediaListQuerySchema)) query: MediaListQuery) {
    return this.media.list(query);
  }

  @Get('folders')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'Folder tree with per-folder file counts' })
  folders() {
    return this.media.listFolders();
  }

  @Post('folders')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Create a folder' })
  createFolder(@Body(zod(mediaFolderInputSchema)) body: MediaFolderInput) {
    return this.media.createFolder(body);
  }

  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Delete an empty folder' })
  async removeFolder(@Param('id') id: string): Promise<void> {
    await this.media.removeFolder(id);
  }

  /**
   * Accepts several files in one request, because the media tab of the product editor
   * uploads a whole gallery at once. Each file is validated on its own, so one bad
   * file does not lose the rest of the batch.
   */
  @Post()
  @RequirePermissions('catalog.write')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: UPLOAD_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one or more files' })
  async upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: { folderId?: string; alt?: string },
  ) {
    const uploaded = files ?? [];
    const created = [];
    const failed: Array<{ fileName: string; message: string }> = [];

    for (const file of uploaded) {
      try {
        created.push(
          await this.media.upload(file, { folderId: body.folderId, alt: body.alt }),
        );
      } catch (error) {
        failed.push({
          fileName: file.originalname,
          message: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }

    return { data: created, meta: { uploaded: created.length, failed } };
  }

  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOperation({ summary: 'One file with its renditions and usage count' })
  get(@Param('id') id: string) {
    return this.media.get(id);
  }

  @Patch(':id')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Rename, move, set alt text or assign a poster' })
  patch(@Param('id') id: string, @Body(zod(mediaPatchSchema)) body: MediaPatchInput) {
    return this.media.patch(id, body);
  }

  @Post(':id/reprocess')
  @RequirePermissions('catalog.write')
  @ApiOperation({ summary: 'Queue the file for processing again' })
  reprocess(@Param('id') id: string) {
    return this.media.reprocess(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('catalog.delete')
  @ApiOperation({ summary: 'Delete a file that nothing references' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.media.remove(id);
  }
}
