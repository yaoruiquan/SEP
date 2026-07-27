import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";
import { CapabilityService } from "../capability/capability.service";
import { AdapterInput } from "../capability/adapters/adapter.interface";
import { SessionLockService } from "./session-lock.service";
import { ConversationService } from "./conversation.service";
import {
  DEFAULT_MODEL_ID,
  calculateCost,
  parseUsdToCnyRate,
  SETTING_KEYS,
} from "shared";
import { SettingService } from "../setting/setting.service";
import {
  SseEvent,
  ModelMessage,
  StoredToolCall,
  AssistantMessageContent,
  ToolResultContent,
} from "./conversation.types";

@Injectable()
export class ConversationStreamService {
  private readonly logger = new Logger(ConversationStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityService: CapabilityService,
    private readonly sessionLockService: SessionLockService,
    private readonly conversationService: ConversationService,
    private readonly configService: ConfigService,
    private readonly settingService: SettingService,
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
      include: {
        employee: {
          include: {
            bindings: {
              include: {
                capability: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    inputSchema: true,
                  },
                },
              },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new ForbiddenException();

    const employee = session.employee;

    // 2. 获取分布式锁（防并发）
    const lockValue = await this.sessionLockService.acquireLock(sessionId);

    try {
      // 3. 持久化用户消息
      await this.prisma.message.create({
        data: { sessionId, role: "USER", content },
      });

      // 4. 加载历史消息（最近 20 条，已含刚写入的本轮用户消息）
      // 注意：本轮用户消息在上一步已落库，loadMessages 会把它一并读出，
      // 所以这里不能再 push 一次 —— 否则模型会连续看到两条一样的用户消息。
      const messages = await this.loadMessages(sessionId, 20);

      // 5. 构建工具映射
      const { tools, capabilityByToolName } = this.buildTools(
        employee.bindings,
      );

      // 6. 初始化 sub2api provider
      const baseURL = this.configService.get(
        "SUB2API_BASE_URL",
        "https://longdaoai.cn/v1",
      );
      const apiKey = this.configService.getOrThrow<string>("SUB2API_API_KEY");
      const defaultModel = this.configService.get(
        "SUB2API_DEFAULT_MODEL",
        DEFAULT_MODEL_ID,
      );
      const hasTools = Object.keys(tools).length > 0;
      // includeUsage 会往请求里加 stream_options，让上游回真实 usage —— 这是准确
      // 计费的前提（缺失时只能按字符估算，input token 会被严重低估）。
      // 但 sub2api 中继在 tools + stream_options 同时出现时返回 400 Invalid request，
      // 故仅在无工具时启用；带工具的会话退回字符估算。
      const provider = createOpenAICompatible({
        name: "sub2api",
        baseURL,
        apiKey,
        includeUsage: !hasTools,
      });
      // 会话级模型覆盖：session.modelId > employee.modelId > 系统默认
      const modelId = session.modelId || employee.modelId || defaultModel;

      // 7. 手动工具循环(每轮一步,finishReason === 'tool-calls' 则继续)
      let stepCount = 0;
      let accumulatedText = "";
      let finishReason: string | undefined;
      let usage: any;

      this.logger.debug(
        `[Stream Init] session=${sessionId}, model=${modelId}, tools=${hasTools ? Object.keys(tools).length : 0}`,
      );

      while (stepCount <= employee.maxSteps) {
        this.logger.debug(
          `[Stream Step] step=${stepCount}, messages=${messages.length}`,
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = streamText({
          model: provider(modelId),
          // instructions 是 AI SDK v7 的新 key(原 system)
          instructions: employee.systemPrompt,
          messages: messages as Parameters<typeof streamText>[0]["messages"],
          tools: hasTools ? tools : undefined,
        });

        this.logger.debug(`[Stream Result Created] session=${sessionId}`);

        accumulatedText = "";
        const pendingToolCalls: Array<{
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
        }> = [];

        // 🔴 修复 P0-1: 包裹异常处理
        try {
          // Cast to any: AI SDK v7 stream chunk property names are unstable across patch versions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for await (const rawChunk of result.fullStream) {
            const chunk = rawChunk as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            switch (chunk.type) {
              case "text-delta": {
                const delta: string = chunk.text ?? chunk.textDelta ?? "";
                accumulatedText += delta;
                yield { event: "text_delta", data: delta };
                break;
              }
              case "tool-call": {
                const cap = capabilityByToolName.get(chunk.toolName as string);
                pendingToolCalls.push({
                  toolCallId: (chunk.toolCallId as string) ?? "",
                  toolName: (chunk.toolName as string) ?? "",
                  args: (chunk.input ?? chunk.args ?? {}) as Record<
                    string,
                    unknown
                  >,
                });
                yield {
                  event: "tool_start",
                  data: { name: chunk.toolName, capabilityId: cap?.id },
                };
                break;
              }
              case "reasoning":
              case "reasoning-start":
              case "reasoning-end": {
                const text: string = chunk.content ?? chunk.text ?? "";
                if (text) yield { event: "reasoning_delta", data: text };
                break;
              }
              // AI SDK v7 在 fullStream 中以 error chunk 上报上游错误，
              // 不 throw。若不显式处理，错误会被吞掉，随后 await result.finishReason
              // 抛出无信息的 "No output generated"。这里把真实错误抛出，交给 catch 处理。
              case "error": {
                const err = chunk.error ?? chunk;
                throw err instanceof Error
                  ? err
                  : new Error(
                      typeof err === "string" ? err : JSON.stringify(err),
                    );
              }
            }
          }
        } catch (streamError) {
          // 🔴 修复 P0-1: 捕获流消费异常
          this.logger.error(
            `Stream consumption error for session ${sessionId}:`,
            streamError,
          );
          yield {
            event: "error",
            data: {
              message: `AI 回复生成失败: ${(streamError as Error).message}`,
              code: "STREAM_CONSUMPTION_ERROR",
            },
          };
          // 保存错误消息到数据库
          await this.prisma.message.create({
            data: {
              sessionId,
              role: "ASSISTANT",
              content: "❌ 对话生成失败,请稍后重试",
            },
          });
          break; // 中断循环
        }

        [finishReason, usage] = await Promise.all([
          result.finishReason,
          result.usage,
        ]);

        // ── 最终回复(无工具调用)────────────────────────────────────────────
        if (finishReason !== "tool-calls") {
          // AI SDK v7 usage 字段兼容处理
          let inputTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0;
          let outputTokens =
            usage?.completionTokens ?? usage?.outputTokens ?? 0;

          // 🔴 Fallback: 当上游未返回 token 数据时,使用文本长度估算(1 token ≈ 4 chars)
          if (inputTokens === 0 && content.length > 0) {
            inputTokens = Math.ceil(content.length / 4);
            this.logger.warn(
              `[Billing] Input tokens missing, estimated from content length: ${inputTokens}`,
            );
          }
          if (outputTokens === 0 && accumulatedText.length > 0) {
            outputTokens = Math.ceil(accumulatedText.length / 4);
            this.logger.warn(
              `[Billing] Output tokens missing, estimated from response length: ${outputTokens}`,
            );
          }

          this.logger.debug(
            `[Billing Check] usage=${JSON.stringify(usage)}, input=${inputTokens}, output=${outputTokens}`,
          );

          const saved = await this.prisma.message.create({
            data: {
              sessionId,
              role: "ASSISTANT",
              content: accumulatedText,
              inputTokens,
              outputTokens,
            },
          });

          // 计费记账 (只要有实际对话就记账,不能因上游数据缺失而漏计费)
          if (inputTokens > 0 && outputTokens > 0) {
            this.logger.log(
              `[Billing] Recording usage for session ${sessionId}: input=${inputTokens}, output=${outputTokens}`,
            );
            await this.recordUsage(
              session.userId,
              sessionId,
              modelId,
              inputTokens,
              outputTokens,
            );
          } else {
            this.logger.error(
              `[Billing] Cannot record usage - both input and output tokens are 0 for session ${sessionId}`,
            );
          }

          await this.prisma.conversationSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
          });
          await this.conversationService.autoGenerateTitle(sessionId, content);
          yield { event: "done", data: { messageId: saved.id, usage } };
          break;
        }

        // ── 工具调用步骤：持久化 assistant 消息 ──────────────────────────────
        const storedToolCalls: StoredToolCall[] = pendingToolCalls.map(
          (tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          }),
        );
        await this.prisma.message.create({
          data: {
            sessionId,
            role: "ASSISTANT",
            content: accumulatedText,
            toolCalls: storedToolCalls as unknown as object,
          },
        });

        // ── 手动执行每个工具 ─────────────────────────────────────────────────
        const toolResults: ToolResultContent[] = [];

        for (const tc of pendingToolCalls) {
          const cap = capabilityByToolName.get(tc.toolName);

          // 🔴 修复: 检查工具是否存在
          if (!cap) {
            this.logger.error(
              `Tool "${tc.toolName}" not found in bindings for session ${sessionId}`,
            );
            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: {
                type: "error-text",
                value: `工具 "${tc.toolName}" 未找到或未绑定`,
              },
            });
            yield {
              event: "tool_end",
              data: { name: tc.toolName, success: false, durationMs: 0 },
            };
            continue;
          }

          const startTime = Date.now();
          let resultText = "No result";
          let execSuccess = false;

          try {
            const input: AdapterInput = {
              userMessage: JSON.stringify(tc.args),
              sessionId,
              userId,
            };
            const execResult = await this.capabilityService.execute(
              cap.id,
              input,
            );
            resultText = execResult.success
              ? execResult.output
              : `Error: ${execResult.error}`;
            execSuccess = execResult.success;
            await this.prisma.toolExecution.create({
              data: {
                sessionId,
                capabilityId: cap.id,
                input: tc.args as unknown as object,
                output: { text: resultText },
                duration: Date.now() - startTime,
                status: execResult.success ? "SUCCESS" : "FAILED",
                errorMessage: execResult.error,
              },
            });
          } catch (err) {
            resultText = `Execution error: ${(err as Error).message}`;
            this.logger.error(`Tool execution failed: ${tc.toolName}`, err);
          }

          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: execSuccess
              ? { type: "text", value: resultText }
              : { type: "error-text", value: resultText },
          });
          yield {
            event: "tool_end",
            data: {
              name: tc.toolName,
              success: execSuccess,
              durationMs: Date.now() - startTime,
            },
          };
        }

        // 工具结果的人类可读形式（前端直接渲染这段）
        const toolResultText = toolResults
          .map((r) => `🔧 工具: ${r.toolName}\n📋 结果: ${r.output.value}`)
          .join("\n\n");

        // 持久化工具结果：content 存人类可读文本（前端直接渲染），
        // 结构化部件存 toolCalls 字段供 loadMessages 还原成 ModelMessage。
        // 此前只存可读文本却用 JSON.parse 读回，带工具调用的会话必然续聊失败。
        await this.prisma.message.create({
          data: {
            sessionId,
            role: "TOOL",
            content: toolResultText,
            toolCalls: toolResults as unknown as object,
          },
        });

        // 追加到 messages 供下一轮使用
        // AI SDK v7 的 tool-call 部件字段是 input（v4 时代叫 args）
        const assistantParts: AssistantMessageContent[] = pendingToolCalls.map(
          (tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.args,
          }),
        );
        messages.push({ role: "assistant", content: assistantParts });
        messages.push({ role: "tool", content: toolResults });

        stepCount++;
      }

      // 🔴 修复 P0-3: 兜底逻辑,防止达到 maxSteps 后无最终回复
      if (stepCount > employee.maxSteps) {
        this.logger.warn(
          `Session ${sessionId} reached maxSteps=${employee.maxSteps} without final reply`,
        );
        const fallbackContent =
          accumulatedText || "抱歉,处理步骤超过限制,无法继续生成回复";
        const saved = await this.prisma.message.create({
          data: {
            sessionId,
            role: "ASSISTANT",
            content: fallbackContent,
            inputTokens: null,
            outputTokens: null,
          },
        });
        yield { event: "done", data: { messageId: saved.id, usage: {} } };
      }
    } catch (err) {
      this.logger.error(`Stream error in session ${sessionId}`, err);
      yield {
        event: "error",
        data: { message: (err as Error).message ?? "Stream failed" },
      };
    } finally {
      await this.sessionLockService.releaseLock(sessionId, lockValue);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * 从 DB 加载最近 N 条消息，转换为 AI SDK ModelMessage 格式
   */
  private async loadMessages(
    sessionId: string,
    limit: number,
  ): Promise<ModelMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { role: true, content: true, toolCalls: true },
    });

    rows.reverse(); // 最早的在前
    const messages: ModelMessage[] = [];

    for (const row of rows) {
      if (row.role === "USER") {
        messages.push({ role: "user", content: row.content });
      } else if (row.role === "ASSISTANT") {
        if (row.toolCalls) {
          const tcs = row.toolCalls as unknown as StoredToolCall[];
          const parts: AssistantMessageContent[] = [];
          if (row.content) parts.push({ type: "text", text: row.content });
          parts.push(
            ...tcs.map((tc) => ({
              type: "tool-call" as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              // v7 用 input（非 args）
              input: tc.args,
            })),
          );
          messages.push({ role: "assistant", content: parts });
        } else {
          messages.push({ role: "assistant", content: row.content });
        }
      } else if (row.role === "TOOL") {
        // 结构化部件存在 toolCalls 字段（content 是给前端看的可读文本）。
        // 缺失说明是旧数据（当时只存了可读文本），跳过而非抛错，
        // 否则历史会话一律无法加载。
        if (!row.toolCalls) continue;
        const results = row.toolCalls as unknown as ToolResultContent[];
        messages.push({ role: "tool", content: results });
      }
    }

    return messages;
  }

  /**
   * 从员工绑定的 capabilities 构建 AI SDK tools 对象（无 execute，手动执行）
   */
  private buildTools(
    bindings: Array<{
      capability: {
        id: string;
        name: string;
        description: string;
        inputSchema: unknown;
      };
    }>,
  ) {
    const capabilityByToolName = new Map<
      string,
      { id: string; name: string }
    >();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};

    for (const binding of bindings) {
      const cap = binding.capability;
      // 工具名基于 capability.id（避免中文名转换问题），但必须先做归一化：
      // 部分上游（如 Anthropic）会把工具名里的 `-` 规范成 `_` 再回传，
      // 导致 `demo-cap-search` 发出去、`demo_cap_search` 回来，查表 miss。
      // 这里统一用下划线形式，发送与查表两侧同源。
      const toolName = this.toToolName(cap.id);
      capabilityByToolName.set(toolName, { id: cap.id, name: cap.name });
      tools[toolName] = {
        description: cap.description,
        inputSchema: z.object(
          this.buildZodShape(cap.inputSchema as Record<string, unknown>),
        ),
      };
    }

    return { tools, capabilityByToolName };
  }

  /**
   * capability.id → 合法且稳定的工具名。
   * OpenAI 工具名规范为 `^[a-zA-Z0-9_-]{1,64}$`，但部分上游会把 `-` 归一成 `_`，
   * 故这里主动统一为下划线，保证发送名与回传名一致。
   */
  private toToolName(capabilityId: string): string {
    return capabilityId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
  }

  /**
   * JSON Schema properties → Zod shape（复用自 DigitalEmployeeRunner）
   */
  private buildZodShape(
    schema: Record<string, unknown>,
  ): Record<string, z.ZodTypeAny> {
    const properties = schema?.properties as
      Record<string, Record<string, unknown>> | undefined;
    const required = (schema?.required as string[]) ?? [];

    if (!properties || Object.keys(properties).length === 0) {
      return { input: z.string().describe("User input") };
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, def] of Object.entries(properties)) {
      let zodType: z.ZodTypeAny;
      switch (def.type as string) {
        case "number":
        case "integer":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = z.record(z.any());
          break;
        default:
          zodType = z.string();
      }
      if (typeof def.description === "string") {
        zodType = zodType.describe(def.description);
      }
      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }
    return shape;
  }

  /**
   * 记录 token 使用量并创建计费交易
   */
  private async recordUsage(
    userId: string,
    sessionId: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    try {
      // 汇率取系统设置的生效值（管理端可改），非法值回退默认
      const rate = parseUsdToCnyRate(
        await this.settingService.getEffectiveValue(
          SETTING_KEYS.USD_TO_CNY_RATE,
        ),
      );

      // 计算成本（isFallback=true 表示该模型未配价，按保底价收费）
      const { costUSD, costCNY, isFallback } = calculateCost(
        modelId,
        inputTokens,
        outputTokens,
        rate,
      );

      // 获取或创建用户的计费账户
      const account = await this.prisma.computeAccount.upsert({
        where: { userId },
        create: { userId, balance: 0 },
        update: {},
      });

      // 创建消费记录（负数表示消费）
      await this.prisma.computeTransaction.create({
        data: {
          accountId: account.id,
          type: "CONSUME",
          amount: -costCNY,
          sessionId,
          description: `${modelId} 对话消费${isFallback ? "（保底价）" : ""}`,
          // 存 rate：汇率可被修改，旧账单需能复核当时的换算依据
          metadata: {
            inputTokens,
            outputTokens,
            costUSD,
            costCNY,
            isFallback,
            rate,
          },
        },
      });

      // 更新账户余额
      await this.prisma.computeAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: costCNY } },
      });

      this.logger.log(
        `Recorded usage for user ${userId}: ${inputTokens}/${outputTokens} tokens, cost ¥${costCNY.toFixed(4)}${isFallback ? " [FALLBACK PRICING]" : ""}`,
      );
      if (isFallback) {
        this.logger.warn(
          `Model ${modelId} has no configured pricing — charged at fallback rate. Add it to MODEL_PRICING.`,
        );
      }
    } catch (err) {
      // 计费失败不应阻断对话，记录错误即可
      this.logger.error(`Failed to record usage for user ${userId}`, err);
    }
  }
}
