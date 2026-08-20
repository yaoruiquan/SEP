import { Module } from '@nestjs/common';
import {
  AdminSkillVersionController,
  EnterpriseSkillVersionController,
} from './skill-version.controller';
import { SkillVersionService } from './skill-version.service';

@Module({
  controllers: [EnterpriseSkillVersionController, AdminSkillVersionController],
  providers: [SkillVersionService],
  exports: [SkillVersionService],
})
export class SkillVersionModule {}
