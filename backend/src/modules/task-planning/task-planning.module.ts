import { Module } from '@nestjs/common';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TaskPlanningController } from './task-planning.controller';
import { TaskPlanningService } from './task-planning.service';

@Module({
  imports: [SubscriptionModule],
  controllers: [TaskPlanningController],
  providers: [TaskPlanningService],
})
export class TaskPlanningModule {}
