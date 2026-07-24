import { Module } from '@nestjs/common';
import { CapabilityService } from './capability.service';
import { CapabilityController } from './capability.controller';
import { AdapterFactory } from './adapters/adapter.factory';

@Module({
  controllers: [CapabilityController],
  providers: [CapabilityService, AdapterFactory],
  exports: [CapabilityService], // 供 DigitalEmployee / Conversation 模块注入
})
export class CapabilityModule {}
