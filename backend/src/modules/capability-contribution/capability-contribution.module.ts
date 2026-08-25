import { Module } from '@nestjs/common';
import { CapabilityContributionController } from './capability-contribution.controller';
import { CapabilityContributionAdminController, CapabilityReviewAdminController } from './capability-contribution-admin.controller';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';

@Module({
  controllers: [CapabilityContributionController, CapabilityContributionAdminController, CapabilityReviewAdminController],
  providers: [CapabilityContributionService, CapabilityValidatorService],
  exports: [CapabilityContributionService],
})
export class CapabilityContributionModule {}
