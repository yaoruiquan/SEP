import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { EnterpriseSettingsService } from './enterprise-settings.service';
import { EnterpriseSettingsController } from './enterprise-settings.controller';
import { CustomRoleController } from './custom-role.controller';
import { ApiKeyController } from './api-key.controller';
import { PermissionGuard } from '../../common/guards/permission.guard';

@Module({
  imports: [PrismaModule, EnterpriseModule],
  controllers: [
    EnterpriseSettingsController,
    CustomRoleController,
    ApiKeyController,
  ],
  providers: [EnterpriseSettingsService, PermissionGuard],
  exports: [EnterpriseSettingsService, PermissionGuard],
})
export class EnterpriseSettingsModule {}
