import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Headers,
  Req,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { ClientEmployment } from '../client/client-employment.decorator';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GatewayService } from './gateway.service';
import { GatewayRateLimitGuard } from './gateway-rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ChatCompletionRequestSchema } from 'shared';
import type { ChatCompletionRequest, ChatCompletionUsage } from 'shared';

@ApiTags('gateway')
@Controller('gateway/v1')
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);
  constructor(private readonly gatewayService: GatewayService) {}

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ default: true, auth: true, chat: true })
  @UseGuards(ClientEmploymentGuard, GatewayRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '模型网关（OpenAI 兼容）' })
  @ApiResponse({ status: 200, description: 'Chat Completion JSON 或 SSE 流' })
  @ApiResponse({
    status: 400,
    description: '请求字段或模型白名单校验失败，返回 OpenAI 兼容 error',
  })
  @ApiResponse({ status: 401, description: '雇佣令牌无效或过期' })
  @ApiResponse({ status: 403, description: '无订阅授权或余额不足' })
  @ApiResponse({
    status: 429,
    description:
      '平台模型请求频率限制或上游限流，含 Retry-After 和 error.source',
  })
  @ApiResponse({ status: 502, description: '上游不可用' })
  @ApiResponse({ status: 503, description: '平台限流服务或上游暂不可用' })
  async chatCompletions(
    @Body(new ZodValidationPipe(ChatCompletionRequestSchema))
    dto: ChatCompletionRequest,
    @ClientEmployment() claims: ClientEmploymentClaims,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request & { requestId?: string },
    @Res() res: Response,
  ) {
    // 1. 验证 + 授权
    const {
      enterpriseId,
      subscriptionId,
      memberId,
      employeeId,
      allowedModels,
    } = await this.gatewayService.validateAndAuthorize(claims);

    // 2. 检查模型白名单
    if (!allowedModels.includes(dto.model)) {
      throw new BadRequestException(`模型 "${dto.model}" 不在白名单中`);
    }

    // 3. 由 service 转发；上游错误在发送 SSE 响应头之前返回 JSON。
    const requestId =
      req.requestId || getHeaderValue(headers, 'x-request-id') || randomUUID();
    const client = new AbortController();
    let upstreamFailed = false;
    const onClose = () => {
      if (!res.writableFinished && !upstreamFailed) client.abort();
    };
    res.on('close', onClose);
    if (res.destroyed) client.abort();
    try {
      const startedAt = Date.now();
      const upstreamRes = await this.gatewayService.forwardChatCompletion(
        dto,
        requestId,
        client.signal,
      );
      const logContext = {
        requestId,
        subscriptionId,
        model: dto.model,
        upstreamRequestId: upstreamRes.headers
          .get('x-request-id')
          ?.replace(/[^a-zA-Z0-9._:-]/g, '')
          .slice(0, 128),
      };
      if (dto.stream)
        this.logger.log({
          message: 'provider response received',
          ...logContext,
          status: upstreamRes.status,
          contentType: upstreamRes.headers.get('content-type'),
        });
      const sessionId =
        getHeaderValue(headers, 'x-sep-session-id') ||
        getHeaderValue(headers, 'x-session-id') ||
        `gateway:${claims.sub}:${claims.subscriptionId}`;
      const messageId =
        getHeaderValue(headers, 'x-sep-message-id') || requestId;

      // 5. 流式 or 非流式
      if (dto.stream) {
        if (!upstreamRes.body)
          throw new BadRequestException('无法读取上游响应流');
        // Forward bytes unchanged; parsing is only for accounting and diagnostics.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const observer = this.gatewayService.observeChatCompletionStream();
        let complete = false;
        try {
          const source = Readable.fromWeb(
            upstreamRes.body as NodeReadableStream<Uint8Array>,
          );
          source.once('error', () => {
            upstreamFailed = true;
          });
          await pipeline(
            source,
            async function* (chunks) {
              for await (const chunk of chunks) {
                observer.write(chunk);
                yield chunk;
              }
            },
            res,
          );
          complete = true;
        } catch (error) {
          this.logger.warn({
            message: 'gateway stream interrupted',
            ...logContext,
            durationMs: Date.now() - startedAt,
            clientDisconnected: client.signal.aborted,
            code:
              error?.getResponse?.()?.error?.code ||
              error?.code ||
              'UPSTREAM_STREAM_ERROR',
          });
          // Headers are already sent: terminate abnormally, never fabricate a successful end.
          res.destroy();
        }
        const { usage, finishReason, done } = observer.finish();
        if (complete) {
          const summary = {
            message: 'gateway stream ended',
            ...logContext,
            durationMs: Date.now() - startedAt,
            finishReason,
            done,
          };
          if (!finishReason || !done) this.logger.warn(summary);
          else this.logger.log(summary);
        }

        // 6. 后台记账
        if (usage) {
          setImmediate(() =>
            this.gatewayService.recordTransaction({
              enterpriseId,
              subscriptionId,
              memberId,
              employeeId,
              userId: claims.sub,
              sessionId,
              messageId,
              modelId: dto.model,
              usage,
            }),
          );
        }
      } else {
        // 非流式：直接返回 JSON
        const json = await upstreamRes.json();
        const usage: ChatCompletionUsage | undefined = json.usage;

        res.json(json);

        // 后台记账
        if (usage) {
          setImmediate(() =>
            this.gatewayService.recordTransaction({
              enterpriseId,
              subscriptionId,
              memberId,
              employeeId,
              userId: claims.sub,
              sessionId,
              messageId,
              modelId: dto.model,
              usage,
            }),
          );
        }
      }
    } finally {
      res.off('close', onClose);
    }
  }
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0]?.slice(0, 200) || undefined;
  return value?.slice(0, 200) || undefined;
}
