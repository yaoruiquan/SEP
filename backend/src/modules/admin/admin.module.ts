import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminService } from './admin.service';
import { WalletModule } from '../wallet/wallet.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { SettingModule } from '../setting/setting.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';

@Module({
  imports: [WalletModule, SkillPackageModule, SettingModule, PersonalWalletModule],
  controllers: [AdminController, AdminUploadController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
