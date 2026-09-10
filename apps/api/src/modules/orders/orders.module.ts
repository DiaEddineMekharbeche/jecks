import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ShippingModule } from '../shipping/shipping.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { OrderNumberService } from './order-number.service.js';
import { OrderTransitionService } from './order-transition.service.js';
import { OrdersAdminController } from './orders-admin.controller.js';
import { OrdersAdminService } from './orders-admin.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersListService } from './orders-list.service.js';

/**
 * Orders — PRD Section 7, F-ST-42 and F-AD-30 to F-AD-36.
 *
 * `OrderTransitionService` is exported because delivery (M4) moves orders too: a driver
 * marking a stop delivered and an agent clicking the same button must go through one
 * state machine, not two.
 */
@Module({
  imports: [CartModule, CustomersModule, InventoryModule, ShippingModule],
  controllers: [OrdersController, OrdersAdminController, CheckoutController],
  providers: [
    OrdersListService,
    OrdersAdminService,
    OrderTransitionService,
    OrderNumberService,
    CheckoutService,
  ],
  exports: [OrdersListService, OrderTransitionService, OrdersAdminService],
})
export class OrdersModule {}
