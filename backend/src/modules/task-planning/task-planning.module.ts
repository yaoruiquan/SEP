import { Module } from '@nestjs/common';
import { SubscriptionModule } from '../subscription/subscription.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { SettingModule } from '../setting/setting.module';
import { EnterpriseModelConfigModule } from '../enterprise-model-config/enterprise-model-config.module';
import { TaskPlanningController } from './task-planning.controller';
import { TaskPlanningService } from './task-planning.service';

@Module({
  imports: [SubscriptionModule, EnterpriseModule, SettingModule, EnterpriseModelConfigModule],
  controllers: [TaskPlanningController],
  providers: [TaskPlanningService],
})
export class TaskPlanningModule {}
