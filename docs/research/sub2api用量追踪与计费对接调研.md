# sub2api 用量追踪与计费对接调研

> 调研日期：2026-07-24
> 调研方式：实测 sub2api 端点（`https://longdaoai.cn/v1`）+ 阅读 `@ai-sdk/openai-compatible@3.0.14` 源码 + 现有代码
> 结论优先级：⚠️ 含 1 个必须修复的 bug（流式拿不到 usage）

---

## TL;DR（先看这段）

1. **sub2api 完全兼容 OpenAI `usage` 结构**，返回 `prompt_tokens` / `completion_tokens` / `total_tokens`，**但不返回任何费用（金额）信息**。计费要靠我们自己维护「模型 → 单价」价格表，在后端把 token 换算成人民币。
2. **⚠️ 当前流式对话拿不到 token 用量**。`conversation-stream.service.ts` 创建 provider 时没设 `includeUsage: true`，导致 `result.usage` 的 `inputTokens/outputTokens` 全是 `undefined`。**已实测复现，必须修**。
3. **AI SDK v7 的 usage 字段名变了**：是 `inputTokens` / `outputTokens` / `totalTokens`，不是 v4 的 `promptTokens` / `completionTokens`。现有代码里把 `usage` 直接透传给前端，字段名要对齐。
4. **`deepseek-chat` 这个模型 ID 在 sub2api 上不存在**。`.env.example` 和旧的 AI-Integration 计划里写的 `deepseek-chat` 是错的，实际可用的是 `deepseek-v4-flash` / `deepseek-v4-pro`。代码默认值 `gemini-3.5-flash-high` 是对的。

---

## 一、sub2api 实测返回结构

### 1.1 非流式（`stream: false`）

请求 `POST /v1/chat/completions`，响应顶层字段：

```
['id', 'object', 'created', 'model', 'choices', 'usage']
```

`usage` 字段：

```json
{ "prompt_tokens": 9, "completion_tokens": 26, "total_tokens": 35 }
```

标准 OpenAI 格式，**无 cost / price / 金额字段**。

### 1.2 流式（`stream: true`）

默认的流式 chunk **不带 usage**。必须在请求里加：

```json
{ "stream_options": { "include_usage": true } }
```

加上之后，流的**最后一个 chunk** 会带 usage（此时 `choices` 为空数组）：

```json
data: {"id":"...","object":"chat.completion.chunk","model":"deepseek-v4-flash",
       "choices":[],"usage":{"prompt_tokens":7,"completion_tokens":X,"total_tokens":Y}}
```

### 1.3 可用模型清单（实测 `GET /v1/models`，共 57 个）

关键可用模型（挑选常用）：

| 类别 | 可用 ID |
|------|---------|
| DeepSeek | `deepseek-v4-flash`、`deepseek-v4-pro` |
| Gemini | `gemini-3.5-flash-high`、`gemini-3.5-flash`、`gemini-3-pro-preview`、`gemini-2.5-pro` |
| GPT | `gpt-4o`、`gpt-4o-mini`、`gpt-5.2`、`gpt-5.4-mini` |
| Claude | `claude-sonnet-5`、`claude-haiku-4-5`、`claude-opus-4-8` |
| 国产 | `glm-5.2`、`kimi-k2.6`、`qwen3.7-plus`、`minimax-m3` |

> ⚠️ **`deepseek-chat` 不在列表里**，用它请求会返回：
> `{"message":"Model \"deepseek-chat\" is not supported...","type":"model_not_found"}`
> 需要把 `.env.example`、`docs/plans/AI-Integration-Implementation-Plan.md` 里的 `DEFAULT_MODEL_ID=deepseek-chat` 改掉。

---

## 二、Vercel AI SDK 侧的关键坑

### 2.1 `include_usage` 默认不发（⚠️ 现有 bug）

`@ai-sdk/openai-compatible@3.0.14` 源码：

```js
// dist/index.js:701-702
stream_options: this.config.includeUsage ? { include_usage: true } : void 0
```

即：**只有 `includeUsage: true` 时才会向 sub2api 请求 usage**。而工厂函数默认不开。

现有代码 `conversation-stream.service.ts:75`：

```typescript
const provider = createOpenAICompatible({ name: 'sub2api', baseURL, apiKey });
// ❌ 没有 includeUsage → 流式 result.usage 为空
```

**实测对比**（backend 目录内跑，同一段 prompt）：

```
includeUsage=false: {"inputTokenDetails":{},"outputTokenDetails":{}}       ← 全空
includeUsage=true:  {"inputTokens":8,"outputTokens":...,"totalTokens":...} ← 有值
```

所以 `conversation-stream.service.ts:135` 那句 `yield { event: 'done', data: { messageId, usage } }` 现在给前端发的是空 usage。

**修复**：

```typescript
const provider = createOpenAICompatible({
  name: 'sub2api',
  baseURL,
  apiKey,
  includeUsage: true,   // ✅ 加这一行
});
```

`agent-runtime-test.service.ts` 用的是 `generateText`（非流式），非流式默认能拿到 usage，但为一致性也建议加上。

### 2.2 usage 字段名：v7 用 `inputTokens`（不是 `promptTokens`）

AI SDK v7 的 `LanguageModelUsage` 类型（`node_modules/ai/dist/index.d.ts`）：

```typescript
type LanguageModelUsage = {
  inputTokens: number | undefined;    // = prompt_tokens
  outputTokens: number | undefined;   // = completion_tokens
  totalTokens: number | undefined;    // = total_tokens
  inputTokenDetails: { noCacheTokens, cacheReadTokens };
  outputTokenDetails: { textTokens, reasoningTokens };
};
```

现在代码把这个对象原样 `yield` 给前端，前端要按 `inputTokens/outputTokens/totalTokens` 读。如果前端或计费逻辑里写了 `usage.promptTokens`，会拿到 `undefined`。

---

## 三、计费对接方案（sub2api 不给钱，我们自己算）

### 3.1 现状

- `Message` 表**没有** token 字段 → 用量没落库，无法追溯单条消息成本。
- `ToolExecution.tokensUsed Int?` 字段已存在但没用。
- `ComputeAccount`（余额）+ `ComputeTransaction`（流水，`amount` 正充负消）计费骨架已在，但**没有任何地方写入消费流水**。

### 3.2 建议改动（按优先级）

**P0 — 修 bug + 落库 token（最小闭环）**

1. `conversation-stream.service.ts` 加 `includeUsage: true`。
2. `Message` 表加 token 字段：

```prisma
model Message {
  // ... 现有字段
  inputTokens  Int?     // prompt tokens（仅 ASSISTANT 消息有值）
  outputTokens Int?     // completion tokens
  modelId      String?  // 本条消息实际用的模型（计价依据）
}
```

3. 在 `finishReason !== 'tool-calls'` 落库 assistant 消息时写入 `usage.inputTokens / outputTokens` 和 `modelId`。

**P1 — token → 人民币换算 + 扣费**

4. 新建价格表 `backend/src/shared/model-pricing.ts`：

```typescript
// 单价：元 / 1K tokens（需按 sub2api 实际结算价填，下面是占位）
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash':    { input: 0.0005, output: 0.0015 },
  'deepseek-v4-pro':      { input: 0.002,  output: 0.008  },
  'gemini-3.5-flash-high':{ input: 0.001,  output: 0.003  },
  'gpt-4o-mini':          { input: 0.001,  output: 0.004  },
  // ... 其余模型
};
export const FALLBACK_PRICING = { input: 0.002, output: 0.008 };

export function calcCost(modelId: string, input = 0, output = 0): number {
  const p = MODEL_PRICING[modelId] ?? FALLBACK_PRICING;
  return (input / 1000) * p.input + (output / 1000) * p.output;
}
```

5. 新建 `BillingService`：对话结束后按 `calcCost` 算金额，在一个事务里：
   - `ComputeTransaction` 插一条 `CONSUME`（`amount` 为负，`metadata` 存 `{ modelId, inputTokens, outputTokens }`，`sessionId` 关联会话）；
   - `ComputeAccount.balance` 递减。

**P2 — 前置校验 & 增强**

6. 对话开始前校验余额（`balance <= 0` 拒绝或提示充值）。
7. 管理端用量报表：按 `ComputeTransaction` 聚合出每用户/每模型的 token 与花费。

### 3.3 为什么不直接信任 sub2api 的计费

sub2api 响应里**没有金额**，只有 token 数。平台对用户的定价（可能加价/补贴/不同套餐）是我们自己的商业逻辑，必须在后端维护价格表。sub2api 的 token 数是**计量的事实来源**，我们的价格表是**计价的规则**，两者分离。

---

## 四、落地清单（供 AI-Integration 计划引用）

| # | 改动 | 文件 | 优先级 |
|---|------|------|--------|
| 1 | `createOpenAICompatible` 加 `includeUsage: true` | `conversation-stream.service.ts:75` | P0 ⚠️bug |
| 2 | `.env.example` / plan 里 `deepseek-chat` → `deepseek-v4-pro` | `.env.example`、`docs/plans/*` | P0 |
| 3 | `Message` 加 `inputTokens/outputTokens/modelId` | `schema.prisma` + migrate | P0 |
| 4 | assistant 消息落库时写入 usage | `conversation-stream.service.ts:130` | P0 |
| 5 | 前端 `usage` 按 `inputTokens/outputTokens` 读 | 前端 SSE 消费处 | P0 |
| 6 | 价格表 `model-pricing.ts` | `backend/src/shared/` | P1 |
| 7 | `BillingService`（扣费 + 流水，事务） | `backend/src/modules/...` | P1 |
| 8 | 对话前余额校验 | `conversation-stream.service.ts` 入口 | P2 |
| 9 | 管理端用量报表 | 新模块 | P2 |

---

## 附：实测所用最小校验

- 非流式 usage：直连 `POST /v1/chat/completions`（`stream:false`）观察顶层 `usage`。
- 流式 usage：加 `stream_options.include_usage=true`，读末尾 chunk。
- SDK 行为：backend 目录内用 `createOpenAICompatible` 分别以 `includeUsage` 开/关跑 `streamText`，对比 `await result.usage`。

（所有请求的 API Key 从本地 `.env` 读取，未写入本文档。）
