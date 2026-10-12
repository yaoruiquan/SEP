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
import { EnterpriseModelConfigModule } from '../enterprise-model-config/enterprise-model-config.module';
import { GatewayModelPolicyService } from './gateway-model-policy.service';
import { GatewayAdmissionService } from './gateway-admission.service';
import { GatewayExecutionService } from './gateway-execution.service';
import { GatewayLifecycleModule } from '../../common/lifecycle/gateway-lifecycle.module';

@Module({
  imports: [
    JwtModule.register({}),
    SettingModule,
    ClientModule,
    ComputeCreditModule,
    AuthModule,
    EnterpriseModelConfigModule,
    GatewayLifecycleModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService, GatewayRateLimitService, GatewayRateLimitGuard,
    ClientEmploymentGuard, GatewayAuthRateLimitService, GatewayModelPolicyService,
    GatewayAdmissionService, GatewayExecutionService],
})
export class GatewayModule {}
