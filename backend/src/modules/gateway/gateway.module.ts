import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { SettingModule } from '../setting/setting.module';
import { ClientModule } from '../client/client.module';
import { ComputeCreditModule } from '../compute-credit/compute-credit.module';
import { GatewayRateLimitService } from './gateway-rate-limit.service';
import { GatewayRateLimitGuard } from './gateway-rate-limit.guard';
import { AuthModule } from '../auth/auth.module';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { GatewayAuthRateLimitService } from './gateway-auth-rate-limit.service';
import { GatewayPolicyModule } from './gateway-policy.module';
import { GatewayExecutionService } from './gateway-execution.service';
import { GatewayLifecycleModule } from '../../common/lifecycle/gateway-lifecycle.module';

@Module({
  imports: [
    JwtModule.register({}),
    SettingModule,
    ClientModule,
    ComputeCreditModule,
    AuthModule,
    GatewayPolicyModule,
    GatewayLifecycleModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService, GatewayRateLimitService, GatewayRateLimitGuard,
    ClientEmploymentGuard, GatewayAuthRateLimitService, GatewayExecutionService],
})
export class GatewayModule {}
