import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { CapabilityService } from '../capability/capability.service';
import { AdapterInput } from '../capability/adapters/adapter.interface';
import { SessionLockService } from './session-lock.service';
import { ConversationService } from './conversation.service';
import { DEFAULT_MODEL_ID } from 'shared';
import {
  SseEvent,
  ModelMessage,
  StoredToolCall,
  AssistantMessageContent,
  ToolResultContent,
} from './conversation.types';

@Injectable()
export class ConversationStreamService {
  private readonly logger = new Logger(ConversationStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityService: CapabilityService,
    private readonly sessionLockService: SessionLockService,
    private readonly conversationService: ConversationService,
    private readonly configService: ConfigService,
  ) {}

  // ── main entry ────────────────────────────────────────────────────────────

  async *streamConversation(
    sessionId: string,
    content: string,
    userId: string,
  ): AsyncGenerator<SseEvent> {
    // 1. 验证会话归属 + 加载 employee 配置
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      include: { employee: { include: { bindings: {
            include: { capability: { select: { id: true, name: true, description: true, inputSchema: true } } },
            orderBy: { order: 'asc' },
          } } } },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new ForbiddenException();

    const employee = session.employee;

    // 2. 获取分布式锁（防并发）
    const lockValue = await this.sessionLockService.acquireLock(sessionId);

    try {
      // 3. 持久化用户消息
      await this.prisma.message.create({ data: { sessionId, role: 'USER', content } });

      // 4. 加载历史消息（最近 20 条，不含本轮）
      const messages = await this.loadMessages(sessionId, 20);
      messages.push({ role: 'user', content });

      // 5. 构建工具映射
      const { tools, capabilityByToolName } = this.buildTools(employee.bindings);

      // 6. 初始化 sub2api provider
      const baseURL = this.configService.get('SUB2API_BASE_URL', 'https://longdaoai.cn/v1');
      const apiKey = this.configService.getOrThrow<string>('SUB2API_API_KEY');
      const defaultModel = this.configService.get('SUB2API_DEFAULT_MODEL', DEFAULT_MODEL_ID);
      // includeUsage: true 让流式响应返回 usage 数据（否则 result.usage 为空）
      const provider = createOpenAICompatible({ name: 'sub2api', baseURL, apiKey, includeUsage: true });
      const modelId = employee.modelId || defaultModel;

      // 7. 手动工具循环（每轮一步，finishReason === 'tool-calls' 则继续）
      let stepCount = 0;
      const hasTools = Object.keys(tools).length > 0;

      this.logger.debug(`[Stream Init] session=${sessionId}, model=${modelId}, tools=${hasTools ? Object.keys(tools).length : 0}`);

      while (stepCount <= employee.maxSteps) {
        this.logger.debug(`[Stream Step] step=${stepCount}, messages=${messages.length}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = streamText({
          model: provider(modelId),
          // instructions 是 AI SDK v7 的新 key（原 system）
          instructions: employee.systemPrompt,
          messages: messages as Parameters<typeof streamText>[0]['messages'],
          tools: hasTools ? tools : undefined,
        });

        this.logger.debug(`[Stream Result Created] session=${sessionId}`);

        let accumulatedText = '';
        const pendingToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = [];
        let finishReason: string | undefined;
        let usage: any;

        // 🔴 修复 P0-1: 包裹异常处理
        try {
          // Cast to any: AI SDK v7 stream chunk property names are unstable across patch versions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for await (const rawChunk of result.fullStream) {
            const chunk = rawChunk as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            switch (chunk.type) {
              case 'text-delta': {
                const delta: string = chunk.text ?? chunk.textDelta ?? '';
                accumulatedText += delta;
                yield { event: 'text_delta', data: delta };
                break;
              }
              case 'tool-call': {
                const cap = capabilityByToolName.get(chunk.toolName as string);
                pendingToolCalls.push({
                  toolCallId: (chunk.toolCallId as string) ?? '',
                  toolName: (chunk.toolName as string) ?? '',
                  args: ((chunk.input ?? chunk.args ?? {}) as Record<string, unknown>),
                });
                yield { event: 'tool_start', data: { name: chunk.toolName, capabilityId: cap?.id } };
                break;
              }
              case 'reasoning':
              case 'reasoning-start':
              case 'reasoning-end': {
                const text: string = chunk.content ?? chunk.text ?? '';
                if (text) yield { event: 'reasoning_delta', data: text };
                break;
            }
          }
        } catch (streamError) {
          // 🔴 修复 P0-1: 捕获流消费异常
          this.logger.error(`Stream consumption error for session ${sessionId}:`, streamError);
          yield {
            event: 'error',
            data: {
              message: `AI 回复生成失败: ${(streamError as Error).message}`,
              code: 'STREAM_CONSUMPTION_ERROR',
            }
          };
          // 保存错误消息到数据库
          await this.prisma.message.create({
            data: { sessionId, role: 'ASSISTANT', content: '❌ 对话生成失败,请稍后重试' },
          });
          break;  // 中断循环
        }

        [finishReason, usage] = await Promise.all([result.finishReason, result.usage]);

        // ── 最终回复（无工具调用）────────────────────────────────────────────
        if (finishReason !== 'tool-calls') {
          const saved = await this.prisma.message.create({
            data: { sessionId, role: 'ASSISTANT', content: accumulatedText },
          });
          await this.prisma.conversationSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
          await this.conversationService.autoGenerateTitle(sessionId, content);
          yield { event: 'done', data: { messageId: saved.id, usage } };
          break;
        }

        // ── 工具调用步骤：持久化 assistant 消息 ──────────────────────────────
        const storedToolCalls: StoredToolCall[] = pendingToolCalls.map((tc) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        }));
        await this.prisma.message.create({
          data: { sessionId, role: 'ASSISTANT', content: accumulatedText, toolCalls: storedToolCalls as unknown as object },
        });

        // ── 手动执行每个工具 ─────────────────────────────────────────────────
        const toolResults: ToolResultContent[] = [];

        for (const tc of pendingToolCalls) {
          const cap = capabilityByToolName.get(tc.toolName);

          // 🔴 修复: 检查工具是否存在
          if (!cap) {
            this.logger.error(`Tool "${tc.toolName}" not found in bindings for session ${sessionId}`);
            toolResults.push({
              type: 'tool-result',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              result: `工具 "${tc.toolName}" 未找到或未绑定`,
            });
            yield {
              event: 'tool_end',
              data: { name: tc.toolName, success: false, durationMs: 0 },
            };
            continue;
          }

          const startTime = Date.now();
          let resultText = 'No result';
          let execSuccess = false;

          try {
            const input: AdapterInput = { userMessage: JSON.stringify(tc.args), sessionId, userId };
            const execResult = await this.capabilityService.execute(cap.id, input);
            resultText = execResult.success ? execResult.output : `Error: ${execResult.error}`;
            execSuccess = execResult.success;
            await this.prisma.toolExecution.create({
              data: {
                sessionId, capabilityId: cap.id, input: tc.args as unknown as object,
                output: { text: resultText }, duration: Date.now() - startTime,
                status: execResult.success ? 'SUCCESS' : 'FAILED',
                errorMessage: execResult.error,
              },
            });
          } catch (err) {
            resultText = `Execution error: ${(err as Error).message}`;
            this.logger.error(`Tool execution failed: ${tc.toolName}`, err);
          }

          toolResults.push({ type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, result: resultText });
          yield { event: 'tool_end', data: { name: tc.toolName, success: execSuccess, durationMs: Date.now() - startTime } };
        }

        // 持久化工具结果消息(转为人类可读文本)
        const toolResultText = toolResults.map((r) => {
          const resultStr = typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
          return `🔧 工具: ${r.toolName}\n📋 结果: ${resultStr}`;
        }).join('\n\n');

        await this.prisma.message.create({
          data: { sessionId, role: 'TOOL', content: toolResultText },
        });

        // 追加到 messages 供下一轮使用
        const assistantParts: AssistantMessageContent[] = pendingToolCalls.map((tc) => ({
          type: 'tool-call' as const, toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args,
        }));
        messages.push({ role: 'assistant', content: assistantParts });
        messages.push({ role: 'tool', content: toolResults });

        stepCount++;
      }

      // 🔴 修复 P0-3: 兜底逻辑,防止达到 maxSteps 后无最终回复
      if (stepCount > employee.maxSteps) {
        this.logger.warn(`Session ${sessionId} reached maxSteps=${employee.maxSteps} without final reply`);
        const fallbackContent = accumulatedText || '抱歉,处理步骤超过限制,无法继续生成回复';
        const saved = await this.prisma.message.create({
          data: { sessionId, role: 'ASSISTANT', content: fallbackContent },
        });
        yield { event: 'done', data: { messageId: saved.id, usage: {} } };
      }
    } catch (err) {
      this.logger.error(`Stream error in session ${sessionId}`, err);
      yield { event: 'error', data: { message: (err as Error).message ?? 'Stream failed' } };
    } finally {
      await this.sessionLockService.releaseLock(sessionId, lockValue);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * 从 DB 加载最近 N 条消息，转换为 AI SDK ModelMessage 格式
   */
  private async loadMessages(sessionId: string, limit: number): Promise<ModelMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true, toolCalls: true },
    });

    rows.reverse(); // 最早的在前
    const messages: ModelMessage[] = [];

    for (const row of rows) {
      if (row.role === 'USER') {
        messages.push({ role: 'user', content: row.content });
      } else if (row.role === 'ASSISTANT') {
        if (row.toolCalls) {
          const tcs = row.toolCalls as unknown as StoredToolCall[];
          const parts: AssistantMessageContent[] = [];
          if (row.content) parts.push({ type: 'text', text: row.content });
          parts.push(...tcs.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          })));
          messages.push({ role: 'assistant', content: parts });
        } else {
          messages.push({ role: 'assistant', content: row.content });
        }
      } else if (row.role === 'TOOL') {
        const results = JSON.parse(row.content) as ToolResultContent[];
        messages.push({ role: 'tool', content: results });
      }
    }

    return messages;
  }

  /**
   * 从员工绑定的 capabilities 构建 AI SDK tools 对象（无 execute，手动执行）
   */
  private buildTools(bindings: Array<{ capability: { id: string; name: string; description: string; inputSchema: unknown } }>) {
    const capabilityByToolName = new Map<string, { id: string; name: string }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};

    for (const binding of bindings) {
      const cap = binding.capability;
      // 🔴 修复 P0-2: 使用 capability.id 作为工具名,避免中文转换问题
      // 原: const toolName = cap.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const toolName = cap.id;
      capabilityByToolName.set(toolName, { id: cap.id, name: cap.name });
      tools[toolName] = {
        description: cap.description,
        inputSchema: z.object(this.buildZodShape(cap.inputSchema as Record<string, unknown>)),
      };
    }

    return { tools, capabilityByToolName };
  }

  /**
   * JSON Schema properties → Zod shape（复用自 DigitalEmployeeRunner）
   */
  private buildZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
    const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
    const required = (schema?.required as string[]) ?? [];

    if (!properties || Object.keys(properties).length === 0) {
      return { input: z.string().describe('User input') };
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, def] of Object.entries(properties)) {
      let zodType: z.ZodTypeAny;
      switch (def.type as string) {
        case 'number':
        case 'integer':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.any());
          break;
        case 'object':
          zodType = z.record(z.any());
          break;
        default:
          zodType = z.string();
      }
      if (typeof def.description === 'string') {
        zodType = zodType.describe(def.description);
      }
      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }
    return shape;
  }
}

