import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClientSkillArtifactModule } from '../client/client-skill-artifact.module';
import { EmployeeReadinessService } from './employee-readiness.service';

@Module({
  imports: [PrismaModule, ClientSkillArtifactModule],
  providers: [EmployeeReadinessService],
  exports: [EmployeeReadinessService],
})
export class EmployeeReadinessModule {}
