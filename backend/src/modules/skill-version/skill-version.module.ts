import { Module } from '@nestjs/common';
import {
  AdminSkillVersionController,
  EnterpriseSkillVersionController,
} from './skill-version.controller';
import { SkillVersionService } from './skill-version.service';
import { PersonalSkillSubmissionService } from './personal-skill-submission.service';
import { EnterpriseSkillDefaultService } from './enterprise-skill-default.service';
import { EnterpriseSkillReviewService } from './enterprise-skill-review.service';

@Module({
  controllers: [EnterpriseSkillVersionController, AdminSkillVersionController],
  providers: [SkillVersionService, PersonalSkillSubmissionService, EnterpriseSkillDefaultService, EnterpriseSkillReviewService],
  exports: [SkillVersionService],
})
export class SkillVersionModule {}
