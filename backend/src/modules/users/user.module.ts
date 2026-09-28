import { Module } from '@nestjs/common';
import { UserAvatarController, UserController } from './user.controller';
import { UserService } from './user.service';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UploadModule, AuthModule], // StorageService 由 UploadModule 导出，认证服务统一处理改密安全语义
  controllers: [UserController, UserAvatarController],
  providers: [UserService],
  exports: [UserService], // 供其他模块注入（如 Conversation 需要查用户信息）
})
export class UserModule {}
