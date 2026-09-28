import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { SkillPackageService } from './skill-package.service';

/**
 * SKILL 包解析与存储。贡献中心与运营端上传走同一份实现 ——
 * 两处各写一遍的话，包校验规则一定会漂移。
 */
@Module({
  imports: [UploadModule],
  providers: [SkillPackageService],
  exports: [SkillPackageService],
})
export class SkillPackageModule {}
