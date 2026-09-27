import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminService } from './admin.service';
import { WalletModule } from '../wallet/wallet.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { SettingModule } from '../setting/setting.module';
import { PersonalWalletModule } from '../personal-wallet/personal-wallet.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthService } from './admin-auth.service';

@Module({
  imports: [WalletModule, SkillPackageModule, SettingModule, PersonalWalletModule, AuthModule],
  controllers: [AdminController, AdminUploadController],
  providers: [AdminService, AdminAuthService],
  exports: [AdminService, AdminAuthService],
})
export class AdminModule {}
