import { Module } from '@nestjs/common';
import {
  AdminSkillVersionController,
  EnterpriseSkillVersionController,
} from './skill-version.controller';
import { SkillVersionService } from './skill-version.service';
import { PersonalSkillSubmissionService } from './personal-skill-submission.service';

@Module({
  controllers: [EnterpriseSkillVersionController, AdminSkillVersionController],
  providers: [SkillVersionService, PersonalSkillSubmissionService],
  exports: [SkillVersionService],
})
export class SkillVersionModule {}
