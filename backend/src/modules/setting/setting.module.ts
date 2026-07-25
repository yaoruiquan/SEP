import { Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  controllers: [SettingController],
  providers: [SettingService],
  exports: [SettingService], // 供 conversation / model 模块注入
})
export class SettingModule {}
