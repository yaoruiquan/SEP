import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { SettingModule } from '../setting/setting.module';
import { ClientModule } from '../client/client.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { GatewayRateLimitService } from './gateway-rate-limit.service';
import { GatewayRateLimitGuard } from './gateway-rate-limit.guard';

@Module({
  imports: [
    JwtModule.register({}),
    SettingModule,
    ClientModule,
    ComputeCreditModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService, GatewayRateLimitService, GatewayRateLimitGuard],
})
export class GatewayModule {}
