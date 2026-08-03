import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EnterpriseModule } from '../enterprise/enterprise.module';

@Module({
  imports: [PrismaModule, EnterpriseModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
