import { Module } from '@nestjs/common';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { CapabilityContributionController } from './capability-contribution.controller';
import { CapabilityContributionAdminController, CapabilityReviewAdminController } from './capability-contribution-admin.controller';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';

@Module({
  imports: [SkillPackageModule],
  controllers: [CapabilityContributionController, CapabilityContributionAdminController, CapabilityReviewAdminController],
  providers: [CapabilityContributionService, CapabilityValidatorService],
  exports: [CapabilityContributionService],
})
export class CapabilityContributionModule {}
