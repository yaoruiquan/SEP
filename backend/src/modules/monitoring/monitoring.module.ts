import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MonitoringService } from './services/monitoring.service';
import { AlertingService } from './services/alerting.service';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { MonitoringController } from './monitoring.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // 启用定时任务
    PrismaModule,
  ],
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    AlertingService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [MonitoringService, AlertingService],
})
export class MonitoringModule {}
