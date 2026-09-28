import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { RpaPackageService } from './rpa-package.service';

@Module({
  imports: [UploadModule],
  providers: [RpaPackageService],
  exports: [RpaPackageService],
})
export class RpaPackageModule {}
