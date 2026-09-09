import { Module } from '@nestjs/common';
import { GlobalSearchController } from './global-search.controller.js';
import { GlobalSearchService } from './global-search.service.js';

@Module({
  controllers: [GlobalSearchController],
  providers: [GlobalSearchService],
})
export class GlobalSearchModule {}
