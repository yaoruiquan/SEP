import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { ConfigModule } from '@nestjs/config';
import { EnterpriseModelPolicyModule } from '../enterprise-model-config/enterprise-model-policy.module';
import { GatewayAdmissionService } from './gateway-admission.service';
import { GatewayModelPolicyService } from './gateway-model-policy.service';

@Module({
  imports: [RedisModule, ConfigModule, EnterpriseModelPolicyModule],
  providers: [GatewayAdmissionService, GatewayModelPolicyService],
  exports: [GatewayAdmissionService, GatewayModelPolicyService],
})
export class GatewayPolicyModule {}
