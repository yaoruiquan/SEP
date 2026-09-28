import { Module } from '@nestjs/common';
import { CapabilityService } from './capability.service';
import { CapabilityController } from './capability.controller';
import { AdapterFactory } from './adapters/adapter.factory';
import { SkillVersionModule } from '../skill-version/skill-version.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { CapabilityContributionModule } from '../capability-contribution/capability-contribution.module';

@Module({
  imports: [SkillVersionModule, SkillPackageModule, CapabilityContributionModule],
  controllers: [CapabilityController],
  providers: [CapabilityService, AdapterFactory],
  exports: [CapabilityService], // 供 DigitalEmployee / Conversation 模块注入
})
export class CapabilityModule {}
