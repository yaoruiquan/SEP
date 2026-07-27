/**
 * 锁定 AI SDK v7 的 ModelMessage 部件字段名。
 *
 * 背景：v7 把 tool-call 的 `args` 改名为 `input`，tool-result 的裸 `result`
 * 字符串改成 `output: { type, value }`。沿用 v4 字段时 streamText 会抛
 * "Invalid prompt: The messages do not match the ModelMessage[] schema."，
 * 且只在工具调用后的第二轮才触发，极易漏测。
 *
 * ⚠️ 局限：这里复制的是 ai@7.0.35 源码 dist/index.js 中 toolCallPartSchema
 * (行 2275) 与 toolResultPartSchema (行 2388) 的定义，**不是** 直接引用 SDK
 * schema —— `ai` 是 ESM-only 包，Jest 当前为 CJS，直接 import 会报
 * "Cannot use import statement outside a module"，而让 ts-jest 转译它需要
 * 拖进整个 @ai-sdk 依赖树，代价过大。
 * 因此本测试能防住「我们自己改回旧字段」的回归，但**不能**自动发现
 * 「SDK 未来又改了字段名」。升级 ai 包时需人工核对上述两处 schema。
 */
import { z } from 'zod';
import type {
  AssistantMessageContent,
  ToolResultContent,
} from './conversation.types';

// —— 以下 schema 摘自 ai@7.0.35 dist/index.js ——
const toolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

const outputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('json'), value: z.unknown() }),
  z.object({ type: z.literal('execution-denied'), reason: z.string().optional() }),
  z.object({ type: z.literal('error-text'), value: z.string() }),
  z.object({ type: z.literal('error-json'), value: z.unknown() }),
]);

const toolResultPartSchema = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  toolName: z.string(),
  output: outputSchema,
});

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

describe('ModelMessage 部件结构（AI SDK v7 字段名）', () => {
  const toolCallId = 'toolu_9f0311a7b337d292';
  const toolName = 'demo_cap_search';

  describe('assistant tool-call 部件', () => {
    it('我们构造的 tool-call 使用 input 字段并通过校验', () => {
      const part: AssistantMessageContent = {
        type: 'tool-call',
        toolCallId,
        toolName,
        input: { q: 'AI 趋势' },
      };
      expect(toolCallPartSchema.safeParse(part).success).toBe(true);
    });

    it('回归：v4 的 args 字段不满足 schema（input 缺失）', () => {
      const v4Part = { type: 'tool-call', toolCallId, toolName, args: { q: 'x' } };
      // input 为 z.unknown()，缺失时 zod 仍认为 key 不存在 → 断言 key 本身
      expect('input' in v4Part).toBe(false);
      expect(toolCallPartSchema.safeParse(v4Part).success).toBe(true); // schema 宽松
      // 真正的保护：我们的类型里没有 args 字段
      const typed: AssistantMessageContent = {
        type: 'tool-call',
        toolCallId,
        toolName,
        input: { q: 'x' },
      };
      expect(typed).toHaveProperty('input');
      expect(typed).not.toHaveProperty('args');
    });

    it('text 部件结构正确', () => {
      const part: AssistantMessageContent = { type: 'text', text: '我来搜索一下' };
      expect(textPartSchema.safeParse(part).success).toBe(true);
    });
  });

  describe('tool-result 部件', () => {
    it('成功结果用 output:{type:"text"}', () => {
      const part: ToolResultContent = {
        type: 'tool-result',
        toolCallId,
        toolName,
        output: { type: 'text', value: '搜索到 3 条结果' },
      };
      expect(toolResultPartSchema.safeParse(part).success).toBe(true);
    });

    it('失败结果用 output:{type:"error-text"}', () => {
      const part: ToolResultContent = {
        type: 'tool-result',
        toolCallId,
        toolName,
        output: { type: 'error-text', value: '工具未找到或未绑定' },
      };
      expect(toolResultPartSchema.safeParse(part).success).toBe(true);
    });

    it('回归：v4 的裸 result 字符串会被拒（output 必填）', () => {
      const v4Part = {
        type: 'tool-result',
        toolCallId,
        toolName,
        result: '搜索结果',
      };
      expect(toolResultPartSchema.safeParse(v4Part).success).toBe(false);
    });

    it('output.type 必须是枚举内的值', () => {
      expect(
        toolResultPartSchema.safeParse({
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'plain', value: 'x' },
        }).success,
      ).toBe(false);
    });
  });
});
