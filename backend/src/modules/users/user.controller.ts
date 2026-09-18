import {
  Controller,
  Get,
  Patch,
  Body,
  Request,
  Param,
  Post,
  Response,
  HttpCode,
  HttpStatus,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response as ExpressResponse } from 'express';
import { UserService, MAX_USER_AVATAR_SIZE } from './user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateProfileDtoSchema, ChangePasswordDtoSchema } from 'shared';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: '获取当前用户资料' })
  @ApiResponse({ status: 200, description: '用户资料' })
  getMe(@Request() req: any) {
    return this.userService.getProfile(req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: '更新当前用户资料（name / avatar）' })
  @ApiResponse({ status: 200, description: '更新后的用户资料' })
  updateMe(@Request() req: any, @Body() body: unknown) {
    const dto = UpdateProfileDtoSchema.parse(body);
    return this.userService.updateProfile(req.user.id, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '修改密码' })
  @ApiResponse({ status: 204, description: '密码修改成功' })
  @ApiResponse({ status: 401, description: '当前密码不正确' })
  async changePassword(@Request() req: any, @Body() body: unknown) {
    const dto = ChangePasswordDtoSchema.parse(body);
    await this.userService.changePassword(req.user.id, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '上传当前用户头像（本地图片）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: '返回不带过期签名的头像地址 { avatar }' })
  @ApiResponse({ status: 400, description: '文件为空、类型不支持或文件头与扩展名不符' })
  @ApiResponse({ status: 413, description: '头像超过 2MB' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_USER_AVATAR_SIZE, files: 1, fields: 0 } }))
  uploadAvatar(@Request() req: any, @UploadedFile() file?: Express.Multer.File) {
    return this.userService.uploadAvatar(req.user.id, file);
  }

  @Get('me/compute-usage')
  @ApiOperation({ summary: '获取当前用户的计算用量统计' })
  @ApiResponse({ status: 200, description: '用量统计和交易记录' })
  getComputeUsage(@Request() req: any) {
    return this.userService.getComputeUsage(req.user.id);
  }
}

/**
 * 头像读接口单独成类，**刻意不挂 JwtAuthGuard**。
 *
 * 浏览器的 <img src> 发不出 Authorization 头，读接口若有守卫就永远 401，
 * 前端只能回落到首字母占位。与本模块其余接口不同，这里的安全边界不是
 * 「谁登录了」，而是「文件名不可枚举」—— 只有服务端 randomUUID 生成、
 * 且经正则白名单校验的名字才可能命中，详见 UserService.readAvatar。
 */
@ApiTags('users')
@Controller('users/avatars')
export class UserAvatarController {
  constructor(private readonly userService: UserService) {}

  @Get(':filename')
  @ApiOperation({ summary: '读取已发布的用户头像（公开图片）' })
  @ApiResponse({ status: 200, description: 'PNG、JPEG 或 WebP 图片' })
  @ApiResponse({ status: 404, description: '头像不存在或已更换' })
  async read(@Param('filename') filename: string, @Response() response: ExpressResponse) {
    const { buffer, mime } = await this.userService.readAvatar(filename);
    response.setHeader('Content-Type', mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(buffer);
  }
}
