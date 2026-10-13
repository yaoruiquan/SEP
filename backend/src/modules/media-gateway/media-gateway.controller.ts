import {
  Body, Controller, Get, Header, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { z } from 'zod';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { ClientEmployment } from '../client/client-employment.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MediaGatewayIdSchema, MediaGatewayQuoteRequestSchema, MediaGatewayRequestSchema } from 'shared';
import type { MediaGatewayQuoteRequest, MediaGatewayRequest } from 'shared';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';

@ApiTags('media-gateway-mock')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: '字段、参考图片或参数无效' })
@ApiResponse({ status: 401, description: 'employment token 无效' })
@ApiResponse({ status: 403, description: '订阅授权失效或模拟预算不足' })
@ApiResponse({ status: 404, description: '当前作用域内不存在资源' })
@ApiResponse({ status: 409, description: '幂等冲突、报价/配置失效或不支持取消' })
@ApiResponse({ status: 410, description: '参考或结果已过期' })
@ApiResponse({ status: 429, description: '默认业务限流或 mock 进程容量限制' })
@ApiResponse({ status: 503, description: 'mock 未启用或查询暂不可用；生产执行保持关闭' })
@SkipThrottle({ auth: true, chat: true })
@UseGuards(ClientEmploymentGuard, MediaGatewayMockGuard)
@Controller('gateway/v1/media')
export class MediaGatewayController {
  constructor(private readonly media: MediaGatewayService) {}

  @Get('profiles')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '获取开发环境 mock 场景和静态参考 fixture，不改变生产 runtime' })
  @ApiResponse({ status: 200, description: 'mock profiles、测试 fixture、内存存储声明' })
  profiles(@ClientEmployment() claims: ClientEmploymentClaims) { return this.media.profiles(claims); }

  @Post('references')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '验证静态 mock 参考 PNG，只保存元数据' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: '作用域隔离的参考描述' })
  @ApiResponse({ status: 413, description: '超过 mock 文件大小限制' })
  @UseInterceptors(FileInterceptor('file', {
    // Busboy emits partsLimit when the threshold is reached, not exceeded.
    storage: memoryStorage(), limits: { fileSize: 64 * 1024, files: 1, fields: 0, parts: 2 },
  }))
  reference(@ClientEmployment() claims: ClientEmploymentClaims, @UploadedFile() file: Express.Multer.File, @Body() fields: unknown) {
    return this.media.uploadReference(claims, file, fields);
  }

  @Post('quotes')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '生成模拟报价，不读取或扣减真实钱包' })
  @ApiResponse({ status: 201, description: 'mock 报价；未知价格不表示免费' })
  @ApiResponse({ status: 422, description: '不支持的 profile 或规格' })
  quote(@ClientEmployment() claims: ClientEmploymentClaims, @Body(new ZodValidationPipe(MediaGatewayQuoteRequestSchema)) dto: MediaGatewayQuoteRequest) {
    return this.media.quote(claims, dto);
  }

  @Post('requests')
  @ApiOperation({ summary: '幂等创建 mock 回执，最多提交一次静态适配器' })
  @ApiResponse({ status: 200, description: '同步或终态回执' })
  @ApiResponse({ status: 202, description: '已受理或提交结果不明的回执' })
  async submit(
    @ClientEmployment() claims: ClientEmploymentClaims,
    @Body(new ZodValidationPipe(MediaGatewayRequestSchema)) dto: MediaGatewayRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const receipt = await this.media.submit(claims, dto);
    res.status(['SUBMITTING', 'QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN'].includes(receipt.status) ? 202 : 200);
    res.setHeader('Cache-Control', 'no-store');
    return receipt;
  }

  @Get('requests/by-client-id/:requestId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '查找原 mock 回执，不推进适配器、不重新生成' })
  @ApiResponse({ status: 200, description: '当前成员/订阅所属回执' })
  byClientId(@ClientEmployment() claims: ClientEmploymentClaims, @Param('requestId', new ZodValidationPipe(MediaGatewayIdSchema)) id: string) {
    return this.media.findByClientId(claims, id);
  }

  @Get('requests/:receiptId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '由客户端请求推进 mock 异步查询，无后台 worker' })
  @ApiResponse({ status: 200, description: '原回执和模拟状态' })
  receipt(@ClientEmployment() claims: ClientEmploymentClaims, @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) id: string) {
    return this.media.receipt(claims, id);
  }

  @Get('requests/:receiptId/outputs/:outputId/content')
  @ApiOperation({ summary: '授权后下载固定测试 PNG，不读取上游 URL 或真实生成结果' })
  @ApiResponse({ status: 200, description: '裸 PNG 字节及 SHA256 响应头' })
  async content(
    @ClientEmployment() claims: ClientEmploymentClaims,
    @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) receiptId: string,
    @Param('outputId', new ZodValidationPipe(MediaGatewayIdSchema)) outputId: string,
    @Res() res: Response,
  ) {
    const { output, bytes } = await this.media.content(claims, receiptId, outputId);
    res.set({
      'Content-Type': output.mimeType, 'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${output.outputId}.png"`,
      'X-SHA256': output.sha256, 'X-SEP-Media-Mock': 'true',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    res.send(bytes);
  }

  @Post('requests/:receiptId/cancel')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '模拟有能力的取消，不宣称退款或真实上游取消' })
  @ApiResponse({ status: 201, description: '取消后的原 mock 回执' })
  cancel(
    @ClientEmployment() claims: ClientEmploymentClaims,
    @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) id: string,
    @Body(new ZodValidationPipe(z.object({}).strict().default({}))) _body: Record<string, never>,
  ) { return this.media.cancel(claims, id); }
}
