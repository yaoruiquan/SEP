import { Module } from '@nestjs/common';
import { ComputeController } from './compute.controller';
import { ComputeService } from './compute.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';

@Module({
  imports: [PrismaModule, EnterpriseModule],
  controllers: [ComputeController],
  providers: [ComputeService],
  exports: [ComputeService],
})
export class ComputeModule {}
