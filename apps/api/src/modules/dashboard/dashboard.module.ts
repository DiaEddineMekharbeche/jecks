import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { InsightsService } from './insights.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, InsightsService],
})
export class DashboardModule {}
