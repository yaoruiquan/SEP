import { Body, Controller, Get, Header, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { MediaGatewayIdSchema, MediaVideoGatewayQuoteRequestSchema, MediaVideoGatewayRequestSchema } from 'shared';
import type { MediaVideoGatewayQuoteRequest, MediaVideoGatewayRequest } from 'shared';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaVideoGatewayService } from './media-video-gateway.service';

@ApiTags('media-video-gateway-mock')
@ApiBearerAuth()
@ApiResponse({ status: 200, description: '视频 mock 查询或下载成功' })
@ApiResponse({ status: 201, description: '视频 mock 参考图或报价已保存' })
@ApiResponse({ status: 202, description: '视频 mock 任务已入队' })
@ApiResponse({ status: 400, description: '输入参数或参考图无效' })
@ApiResponse({ status: 401, description: 'employment token 无效' })
@ApiResponse({ status: 403, description: '订阅授权失效或参考输入无效' })
@ApiResponse({ status: 404, description: '当前作用域内不存在资源' })
@ApiResponse({ status: 409, description: '视频任务冲突' })
@ApiResponse({ status: 410, description: '视频结果已过期' })
@ApiResponse({ status: 413, description: '上传文件超过限制' })
@ApiResponse({ status: 429, description: '默认业务限流' })
@ApiResponse({ status: 503, description: '视频 mock 未启用或规格不支持' })
@SkipThrottle({ auth: true, chat: true })
@UseGuards(ClientEmploymentGuard, MediaGatewayMockGuard)
@Controller('gateway/v1/media/video')
export class MediaVideoGatewayController {
  constructor(private readonly media: MediaVideoGatewayService) {}

  @Get('profiles')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '获取视频 mock Profile，不执行真实视频任务' })
  profiles(@ClientEmployment() claims: ClientEmploymentClaims) { return this.media.profiles(claims); }

  @Post('references')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '上传视频 mock 的商品参考图' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 64 * 1024, files: 1, fields: 0, parts: 2 } }))
  reference(@ClientEmployment() claims: ClientEmploymentClaims, @UploadedFile() file: Express.Multer.File, @Body() fields: unknown) {
    return this.media.reference(claims, file, fields);
  }

  @Post('quotes')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '生成视频 mock 报价，不扣费' })
  quote(@ClientEmployment() claims: ClientEmploymentClaims, @Body(new ZodValidationPipe(MediaVideoGatewayQuoteRequestSchema)) dto: MediaVideoGatewayQuoteRequest) { return this.media.quote(claims, dto); }

  @Post('requests')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '幂等提交视频 mock 异步任务' })
  async submit(@ClientEmployment() claims: ClientEmploymentClaims, @Body(new ZodValidationPipe(MediaVideoGatewayRequestSchema)) dto: MediaVideoGatewayRequest, @Res({ passthrough: true }) res: Response) {
    const receipt = await this.media.submit(claims, dto);
    res.status(['SUBMITTING', 'QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN'].includes(receipt.status) ? 202 : 200);
    return receipt;
  }

  @Get('requests/by-client-id/:requestId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '按 clientRequestId 找回原视频回执' })
  byClientId(@ClientEmployment() claims: ClientEmploymentClaims, @Param('requestId', new ZodValidationPipe(MediaGatewayIdSchema)) requestId: string) { return this.media.findByClientId(claims, requestId); }

  @Get('requests/:receiptId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '请求驱动查询原视频任务' })
  receipt(@ClientEmployment() claims: ClientEmploymentClaims, @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) receiptId: string) { return this.media.receipt(claims, receiptId); }

  @Get('requests/:receiptId/outputs/:outputId/content')
  @ApiOperation({ summary: '下载视频 mock 输出字节' })
  async content(@ClientEmployment() claims: ClientEmploymentClaims, @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) receiptId: string, @Param('outputId', new ZodValidationPipe(MediaGatewayIdSchema)) outputId: string, @Res() res: Response) {
    const { output, bytes } = await this.media.content(claims, receiptId, outputId);
    res.set({ 'Content-Type': output.mimeType, 'Content-Length': String(bytes.length), 'X-SHA256': output.sha256, 'X-SEP-Media-Mock': 'true', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(bytes);
  }

  @Post('requests/:receiptId/cancel')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '视频 mock 当前不支持取消' })
  cancel(@ClientEmployment() claims: ClientEmploymentClaims, @Param('receiptId', new ZodValidationPipe(MediaGatewayIdSchema)) receiptId: string,
    @Body(new ZodValidationPipe(z.object({}).strict().default({}))) _body: Record<string, never>) {
    return this.media.cancel(claims, receiptId);
  }
}
