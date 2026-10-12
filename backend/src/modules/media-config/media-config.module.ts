import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingModule } from '../setting/setting.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { MediaConfigController } from './media-config.controller';
import { MediaConfigService } from './media-config.service';

@Module({
  imports: [PrismaModule, SettingModule, EnterpriseModule],
  controllers: [MediaConfigController],
  providers: [MediaConfigService],
  exports: [MediaConfigService],
})
export class MediaConfigModule {}
