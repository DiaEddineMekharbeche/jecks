import { Global, Module } from '@nestjs/common';
import { StorefrontController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Global: pricing, orders and notifications all read settings. */
@Global()
@Module({
  controllers: [StorefrontController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
