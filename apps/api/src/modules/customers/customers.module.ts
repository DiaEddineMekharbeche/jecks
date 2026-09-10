import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { LoyaltyService } from './loyalty.service.js';

/**
 * Customers and loyalty — PRD F-AD-40 to F-AD-42 and Section 6.5.
 *
 * Both services are exported: orders refresh a customer's rollups on every transition,
 * and the worker awards points when a parcel is delivered.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, LoyaltyService],
  exports: [CustomersService, LoyaltyService],
})
export class CustomersModule {}
