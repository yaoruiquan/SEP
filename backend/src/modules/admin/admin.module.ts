import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminService } from './admin.service';
import { WalletModule } from '../wallet/wallet.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';

@Module({
  imports: [WalletModule, SkillPackageModule],
  controllers: [AdminController, AdminUploadController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
