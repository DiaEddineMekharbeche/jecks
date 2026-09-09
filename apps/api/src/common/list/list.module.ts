import { Global, Module } from '@nestjs/common';
import { ExportService } from './export.service.js';

/**
 * Every admin list exports. Making this global means a new module gets CSV and XLSX
 * by injecting one service, rather than by remembering to import a module.
 */
@Global()
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ListModule {}
