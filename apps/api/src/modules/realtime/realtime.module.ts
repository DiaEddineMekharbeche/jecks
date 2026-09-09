import { Global, Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeService } from './realtime.service.js';

/** Global: orders, shipments and inventory all publish to the same stream. */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
