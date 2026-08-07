import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CostAnalyticsController } from './cost-analytics.controller';
import { CostAnalyticsService } from './cost-analytics.service';
import { CostAnalyticsCronService } from './cost-analytics-cron.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  controllers: [CostAnalyticsController],
  providers: [CostAnalyticsService, CostAnalyticsCronService],
  exports: [CostAnalyticsService],
})
export class CostAnalyticsModule {}
