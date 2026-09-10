import { Module } from '@nestjs/common';
import { CouriersModule } from '../couriers/couriers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CashService } from './cash.service.js';
import { CourierSyncService } from './courier-sync.service.js';
import { CouriersAdminService } from './couriers-admin.service.js';
import { DeliveryAnalyticsService } from './delivery-analytics.service.js';
import {
  CashController,
  CourierSyncController,
  CouriersController,
  DeliveryAnalyticsController,
  DeliveryRunsController,
  DriverController,
  DriversController,
  SettlementsController,
  ShipmentsController,
  ShippingRatesController,
  ShippingZonesController,
  VehiclesController,
} from './delivery.controller.js';
import { FleetService } from './fleet.service.js';
import { RunsService } from './runs.service.js';
import { SettlementsService } from './settlements.service.js';
import { ShipmentsService } from './shipments.service.js';
import { ZonesService } from './zones.service.js';

/**
 * Delivery, the fleet and cash — PRD F-AD-60 to F-AD-65.
 *
 * `OrdersModule` comes in for the state machine: a stop marked delivered and an agent
 * clicking the same button go through one door. `ShipmentsService` is exported because
 * the webhook module applies courier updates through it.
 */
@Module({
  imports: [CouriersModule, OrdersModule],
  controllers: [
    ShippingZonesController,
    ShippingRatesController,
    CouriersController,
    ShipmentsController,
    VehiclesController,
    DriversController,
    DeliveryRunsController,
    DriverController,
    CashController,
    SettlementsController,
    CourierSyncController,
    DeliveryAnalyticsController,
  ],
  providers: [
    ZonesService,
    CouriersAdminService,
    ShipmentsService,
    FleetService,
    RunsService,
    CashService,
    SettlementsService,
    CourierSyncService,
    DeliveryAnalyticsService,
  ],
  exports: [ShipmentsService, ZonesService, RunsService],
})
export class DeliveryModule {}
