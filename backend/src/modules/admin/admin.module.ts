import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController, AdminUploadController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
