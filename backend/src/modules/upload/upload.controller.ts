import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocalStorageDriver } from './storage/local-storage.driver';
import {
  findAllowedType,
  MAX_FILES_PER_REQUEST,
  MULTER_MAX_FILE_SIZE,
} from './upload.constants';
import { UploadService } from './upload.service';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; role: string };
}

/**
 * memoryStorage 而非 diskStorage：文件要先过魔数校验再决定是否落盘，
 * 而且 OSS 驱动需要 Buffer。上限已由 MULTER_MAX_FILE_SIZE 兜住，
 * 不会有超大文件长期占内存。
 */
const MULTER_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MULTER_MAX_FILE_SIZE, files: MAX_FILES_PER_REQUEST },
};

@ApiTags('upload')
@Controller()
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly localDriver: LocalStorageDriver,
  ) {}

  @Post('upload/file')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '上传单个聊天附件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: '上传成功，返回附件记录' })
  @ApiResponse({ status: 400, description: '类型不支持或内容与扩展名不符' })
  @ApiResponse({ status: 413, description: '文件超过大小上限' })
  @UseInterceptors(FileInterceptor('file', MULTER_OPTIONS))
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthenticatedRequest,
  ) {
    const [attachment] = await this.uploadService.uploadFiles(
      file ? [file] : [],
      req.user.id,
    );
    return attachment;
  }

  @Post('upload/files')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: `批量上传聊天附件（最多 ${MAX_FILES_PER_REQUEST} 个）` })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: '上传成功，返回附件记录数组' })
  @ApiResponse({ status: 400, description: '类型不支持或数量超限' })
  @ApiResponse({ status: 413, description: '文件超过大小上限' })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, MULTER_OPTIONS),
  )
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthenticatedRequest,
  ) {
    return this.uploadService.uploadFiles(files ?? [], req.user.id);
  }

  @Post('upload/refresh-url')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '为已存储对象重新签发访问地址（历史附件链接过期时）' })
  @ApiResponse({ status: 201, description: '返回新的签名 URL' })
  @ApiResponse({ status: 403, description: '附件不属于当前用户' })
  async refreshUrl(
    @Query('key') key: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return { url: await this.uploadService.refreshUrl(key, req.user.id) };
  }

  /**
   * 本地驱动的文件读取端点。
   *
   * 不挂 JwtAuthGuard：图片要走 `<img src>`，浏览器不会带 Authorization 头。
   * 访问控制由 URL 上的 HMAC 签名 + 有效期承担，语义与 OSS 签名 URL 一致。
   * 配了 OSS 后前端拿到的是 OSS 域名，这个端点自然不再被访问。
   */
  @Get('uploads/*')
  @ApiExcludeEndpoint()
  async serveLocal(
    // Express 4（platform-express 10 内部锁定的版本）把通配段绑到参数 "0"，
    // 且已完成 URL 解码。用 *path 命名通配是 Express 5 语法，这里会拿到 undefined。
    @Param('0') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!this.localDriver.verifySignature(key, Number(exp), sig)) {
      throw new ForbiddenException('链接无效或已过期');
    }

    const buffer = await this.localDriver.read(key);
    const filename = key.split('/').pop() ?? 'file';
    const ext = filename.split('.').pop() ?? '';

    res.setHeader(
      'Content-Type',
      findAllowedType(ext)?.mime ?? 'application/octet-stream',
    );
    res.setHeader('Content-Length', buffer.length);
    // 阻止把 HTML/SVG 之类内容当页面执行（白名单已排除，仍做纵深防御）
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    // 私有内容，禁止中间层缓存
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buffer);
  }
}
