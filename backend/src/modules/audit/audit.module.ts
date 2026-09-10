import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditCleanupService } from './audit-cleanup.service';

@Global()
@Module({ imports: [PrismaModule], controllers: [AuditController], providers: [AuditService, AuditCleanupService], exports: [AuditService] })
export class AuditModule {}
