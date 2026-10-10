import { Module } from '@nestjs/common';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';
import { SettingModule } from '../setting/setting.module';
import { CapabilityValidatorService } from '../capability-contribution/capability-validator.service';
import { PackageSecurityService } from '../capability-contribution/package-security.service';
import {
  AdminSkillVersionController,
  EnterpriseSkillVersionController,
} from './skill-version.controller';
import { SkillVersionService } from './skill-version.service';
import { PersonalSkillSubmissionService } from './personal-skill-submission.service';
import { EnterpriseSkillDefaultService } from './enterprise-skill-default.service';
import { EnterpriseSkillReviewService } from './enterprise-skill-review.service';

@Module({
  imports: [SkillPackageModule, PersonalWalletModule, SettingModule],
  controllers: [EnterpriseSkillVersionController, AdminSkillVersionController],
  providers: [CapabilityValidatorService, PackageSecurityService, SkillVersionService, PersonalSkillSubmissionService, EnterpriseSkillDefaultService, EnterpriseSkillReviewService],
  exports: [SkillVersionService],
})
export class SkillVersionModule {}
