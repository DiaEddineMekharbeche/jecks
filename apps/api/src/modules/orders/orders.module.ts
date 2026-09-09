import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersListService } from './orders-list.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersListService],
  exports: [OrdersListService],
})
export class OrdersModule {}
