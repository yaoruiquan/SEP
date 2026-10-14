import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SkillPackageModule } from '../skill-package/skill-package.module';
import { SkillVersionModule } from '../skill-version/skill-version.module';
import { ClientSkillArtifactService } from './client-skill-artifact.service';

// Keep artifact preparation reusable without importing the client HTTP/runtime module.
@Module({
  imports: [PrismaModule, SkillVersionModule, SkillPackageModule],
  providers: [ClientSkillArtifactService],
  exports: [ClientSkillArtifactService],
})
export class ClientSkillArtifactModule {}
