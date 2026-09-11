import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';

/**
 * Global because both the catalogue reads and every admin write touch it: a module that
 * changes a price has to be able to clear the page that shows it.
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
