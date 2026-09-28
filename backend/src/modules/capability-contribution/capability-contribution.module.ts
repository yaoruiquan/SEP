import { Module } from '@nestjs/common';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { RpaPackageModule } from '../rpa-package/rpa-package.module';
import { CapabilityContributionController } from './capability-contribution.controller';
import { CapabilityContributionAdminController, CapabilityReviewAdminController } from './capability-contribution-admin.controller';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';
import { SettingModule } from '../setting/setting.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SkillPackageModule, RpaPackageModule, SettingModule, PersonalWalletModule, NotificationsModule, AuditModule],
  controllers: [CapabilityContributionController, CapabilityContributionAdminController, CapabilityReviewAdminController],
  providers: [CapabilityContributionService, CapabilityValidatorService],
  exports: [CapabilityContributionService],
})
export class CapabilityContributionModule {}
