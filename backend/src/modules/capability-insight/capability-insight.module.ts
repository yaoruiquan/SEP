import { Module } from '@nestjs/common';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { SettingModule } from '../setting/setting.module';
import { SkillVersionModule } from '../skill-version/skill-version.module';
import { CapabilityInsightController } from './capability-insight.controller';
import { CapabilityInsightService } from './capability-insight.service';

@Module({
  imports: [EnterpriseModule, SkillVersionModule, SettingModule],
  controllers: [CapabilityInsightController],
  providers: [CapabilityInsightService],
})
export class CapabilityInsightModule {}
