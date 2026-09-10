import { Module } from '@nestjs/common';
import { ShippingModule } from '../shipping/shipping.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

/** Cart — PRD F-ST-40/41. Exported so checkout can read the same revalidated lines. */
@Module({
  imports: [ShippingModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
