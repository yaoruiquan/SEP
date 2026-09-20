import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { ClientEmployment } from '../client/client-employment.decorator';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { GatewayService } from './gateway.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ChatCompletionRequestSchema } from 'shared';
import type { ChatCompletionRequest, ChatCompletionUsage } from 'shared';

@ApiTags('gateway')
@Controller('gateway/v1')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClientEmploymentGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '模型网关（OpenAI 兼容）' })
  @ApiResponse({ status: 200, description: 'Chat Completion JSON 或 SSE 流' })
  @ApiResponse({ status: 400, description: '请求字段或模型白名单校验失败，返回 OpenAI 兼容 error' })
  @ApiResponse({ status: 401, description: '雇佣令牌无效或过期' })
  @ApiResponse({ status: 403, description: '无订阅授权或余额不足' })
  @ApiResponse({ status: 429, description: '上游限流' })
  @ApiResponse({ status: 502, description: '上游不可用' })
  async chatCompletions(
    @Body(new ZodValidationPipe(ChatCompletionRequestSchema)) dto: ChatCompletionRequest,
    @ClientEmployment() claims: ClientEmploymentClaims,
    @Res() res: Response,
  ) {
    // 1. 验证 + 授权
    const { enterpriseId, subscriptionId, memberId, allowedModels } =
      await this.gatewayService.validateAndAuthorize(claims);

    // 2. 检查模型白名单
    if (!allowedModels.includes(dto.model)) {
      throw new BadRequestException(`模型 "${dto.model}" 不在白名单中`);
    }

    // 3. 由 service 转发；上游错误在发送 SSE 响应头之前返回 JSON。
    const upstreamRes = await this.gatewayService.forwardChatCompletion(dto);

    // 5. 流式 or 非流式
    if (dto.stream) {
      // 流式：透传 SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = upstreamRes.body?.getReader();
      if (!reader) throw new BadRequestException('无法读取上游响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let usage: ChatCompletionUsage | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                res.write(`data: [DONE]\n\n`);
                continue;
              }
              try {
                const json = JSON.parse(data);
                if (json.usage) usage = json.usage; // 最后一块带 usage
                res.write(`data: ${data}\n\n`);
              } catch {
                res.write(`${line}\n`);
              }
            } else if (line.trim()) {
              res.write(`${line}\n`);
            }
          }
        }
      } catch {
        // 流中断，直接断开客户端连接
        res.end();
      }

      res.end();

      // 6. 后台记账
      if (usage) {
        setImmediate(() =>
          this.gatewayService.recordTransaction({
            enterpriseId,
            subscriptionId,
            memberId,
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
            modelId: dto.model,
            usage,
          }),
        );
      }
    }
  }
}
