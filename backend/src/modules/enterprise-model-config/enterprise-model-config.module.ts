import { Module } from '@nestjs/common';
import { EnterpriseModelConfigController } from './enterprise-model-config.controller';
import { DepartmentModelPolicyController } from './department-model-policy.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';
import { EnterpriseModelPolicyModule } from './enterprise-model-policy.module';

@Module({
  imports: [PrismaModule, EnterpriseModule, EnterpriseModelPolicyModule],
  controllers: [EnterpriseModelConfigController, DepartmentModelPolicyController],
  exports: [EnterpriseModelPolicyModule],
})
export class EnterpriseModelConfigModule {}
