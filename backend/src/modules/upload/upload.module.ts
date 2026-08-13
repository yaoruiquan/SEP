import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageDriver } from './storage/local-storage.driver';
import { StorageService } from './storage/storage.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/**
 * 聊天附件上传。
 *
 * EnterpriseContextService 由 @Global 的 EnterpriseModule 导出，无需在此 import。
 * StorageService 一并导出，会话流服务需要它为历史附件重新签发链接。
 */
@Module({
  imports: [ConfigModule],
  controllers: [UploadController],
  providers: [UploadService, StorageService, LocalStorageDriver],
  exports: [UploadService, StorageService],
})
export class UploadModule {}
