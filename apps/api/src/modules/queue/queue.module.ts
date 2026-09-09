import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';

/** Global: media, orders and notifications all enqueue work. */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
