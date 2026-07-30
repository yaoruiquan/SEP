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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClientInstanceGuard } from '../client/client-instance.guard';
import { ClientInstance } from '../client/client-instance.decorator';
import type { ClientInstanceClaims } from '../client/client-instance.guard';
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
  @UseGuards(ClientInstanceGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '模型网关（OpenAI 兼容）' })
  async chatCompletions(
    @Body(new ZodValidationPipe(ChatCompletionRequestSchema)) dto: ChatCompletionRequest,
    @ClientInstance() claims: ClientInstanceClaims,
    @Res() res: Response,
  ) {
    // 1. 验证 + 授权
    const { enterpriseId, instanceId, memberId, allowedModels } =
      await this.gatewayService.validateAndAuthorize(claims);

    // 2. 检查模型白名单
    if (!allowedModels.includes(dto.model)) {
      throw new BadRequestException(`模型 "${dto.model}" 不在白名单中`);
    }

    // 3. 获取 sub2api 配置
    const { baseUrl, apiKey } = await this.gatewayService.getSub2ApiConfig();

    // 4. 转发到 sub2api
    const url = `${baseUrl}/chat/completions`;
    const upstreamRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(dto),
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      throw new BadRequestException(`sub2api 错误(${upstreamRes.status}): ${text}`);
    }

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
      } catch (error) {
        // 流中断，直接断开客户端连接
        res.end();
      }

      res.end();

      // 6. 后台记账
      if (usage) {
        setImmediate(() =>
          this.gatewayService.recordTransaction({
            enterpriseId,
            instanceId,
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
            instanceId,
            memberId,
            modelId: dto.model,
            usage,
          }),
        );
      }
    }
  }
}
