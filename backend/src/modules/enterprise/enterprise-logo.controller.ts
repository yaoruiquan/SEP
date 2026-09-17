import { Controller, Get, Param, Post, Request, Response, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseLogoService, MAX_ENTERPRISE_LOGO_SIZE } from './enterprise-logo.service';

@ApiTags('Enterprise Organization')
@Controller('enterprise')
export class EnterpriseLogoController {
  constructor(private readonly logos: EnterpriseLogoService) {}

  @Post('logo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '上传本企业头像（仅企业管理员）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: '返回不带过期签名的企业头像地址 { logo }' })
  @ApiResponse({ status: 400, description: '文件为空、类型不支持或文件头与扩展名不符' })
  @ApiResponse({ status: 403, description: '非本企业管理员' })
  @ApiResponse({ status: 413, description: '图片超过 2MB' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ENTERPRISE_LOGO_SIZE, files: 1, fields: 0 } }))
  upload(@Request() req: { user: { id: string } }, @UploadedFile() file?: Express.Multer.File) {
    return this.logos.upload(req.user.id, file);
  }

  @Get('logos/:filename')
  @ApiOperation({ summary: '读取已发布的企业头像（公开图片）' })
  @ApiResponse({ status: 200, description: 'PNG、JPEG 或 WebP 图片' })
  @ApiResponse({ status: 404, description: '头像不存在或已更换' })
  async read(@Param('filename') filename: string, @Response() response: ExpressResponse) {
    const { buffer, mime } = await this.logos.read(filename);
    response.setHeader('Content-Type', mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(buffer);
  }
}
