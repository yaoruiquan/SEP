import { Module } from '@nestjs/common';
import { RpaPackageService } from './rpa-package.service';

@Module({
  providers: [RpaPackageService],
  exports: [RpaPackageService],
})
export class RpaPackageModule {}
