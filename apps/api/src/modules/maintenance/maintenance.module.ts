import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

/** The nightly jobs the worker triggers — PRD Section 10.3. */
@Module({
  imports: [CustomersModule, FinanceModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
