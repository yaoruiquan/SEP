import { Module } from '@nestjs/common';
import { EnterpriseModelConfigService } from './enterprise-model-config.service';
import { EnterpriseModelConfigController } from './enterprise-model-config.controller';
import { DepartmentModelPolicyController } from './department-model-policy.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';

@Module({
  imports: [PrismaModule, EnterpriseModule],
  controllers: [EnterpriseModelConfigController, DepartmentModelPolicyController],
  providers: [EnterpriseModelConfigService],
  exports: [EnterpriseModelConfigService],
})
export class EnterpriseModelConfigModule {}
