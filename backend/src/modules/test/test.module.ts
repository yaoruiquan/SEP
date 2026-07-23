import { Module } from '@nestjs/common';
import { AgentRuntimeTestController } from './agent-runtime-test.controller';
import { AgentRuntimeTestService } from './agent-runtime-test.service';

@Module({
  controllers: [AgentRuntimeTestController],
  providers: [AgentRuntimeTestService],
})
export class TestModule {}
