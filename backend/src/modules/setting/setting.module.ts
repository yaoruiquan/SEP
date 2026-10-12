import { Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { ModelRuntimePolicyService } from './model-runtime-policy.service';

@Module({
  controllers: [SettingController],
  providers: [SettingService, ModelRuntimePolicyService],
  exports: [SettingService, ModelRuntimePolicyService],
})
export class SettingModule {}
