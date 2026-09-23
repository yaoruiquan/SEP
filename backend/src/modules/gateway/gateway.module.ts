import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { SettingModule } from '../setting/setting.module';
import { ClientModule } from '../client/client.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';

@Module({
  imports: [
    JwtModule.register({}),
    SettingModule,
    ClientModule,
    ComputeCreditModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class GatewayModule {}
