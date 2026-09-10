import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { TaskExecutionModule } from '../modules/task-execution/task-execution.module';

@Module({ imports: [KnowledgeModule, TaskExecutionModule], controllers: [HealthController] })
export class HealthModule {}
