import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingModule } from '../setting/setting.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { MediaConfigController } from './media-config.controller';
import { MediaConfigService } from './media-config.service';
import { Sub2apiImageAdapter } from '../media-gateway/sub2api-image.adapter';

@Module({
  imports: [PrismaModule, SettingModule, EnterpriseModule],
  controllers: [MediaConfigController],
  providers: [MediaConfigService, Sub2apiImageAdapter],
  exports: [MediaConfigService, Sub2apiImageAdapter],
})
export class MediaConfigModule {}
