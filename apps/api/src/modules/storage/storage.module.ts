import { Global, Module } from '@nestjs/common';
import { DocumentLinksService } from './document-links.service.js';
import { DocumentController, MediaFileController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

/** Global: catalog, orders and documents all resolve media URLs. */
@Global()
@Module({
  controllers: [MediaFileController, DocumentController],
  providers: [StorageService, DocumentLinksService],
  exports: [StorageService, DocumentLinksService],
})
export class StorageModule {}
