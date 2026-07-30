import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { SettingModule } from '../setting/setting.module';
import { ClientModule } from '../client/client.module';

@Module({
  imports: [SettingModule, ClientModule],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class GatewayModule {}
