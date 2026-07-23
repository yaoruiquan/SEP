import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],  // 供其他模块注入（如 Conversation 需要查用户信息）
})
export class UserModule {}
