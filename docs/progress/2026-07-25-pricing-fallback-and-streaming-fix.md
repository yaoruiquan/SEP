# 2026-07-25 保底计费 + 流式对话修复（专题）

> 本日主线：补计费漏洞（未配价模型免费对话）→ 挖出并修复流式对话全面失效 → 发现能力适配器核心缺口
> 参与模块：`shared` `conversation-stream` `model` + 前端 `model`
> 状态：计费改动已验证并有单元测试兜底；流式修复已生效；**未提交**，能力适配器缺口待开发

---

## 一、写给老板（通俗版）

今天做了三件事，其中两件是补窟窿，一件是发现了更大的窟窿。

**第一件：堵住"白用不花钱"的漏洞。**
上游能用的模型有 60 多个，但我们只给 7 个配了价格。剩下的模型一旦被开放给用户，系统算出来的费用是 0 元——等于用户免费用，平台一分钱收不到。现在改成：没配价的模型按**最贵档**收费，宁可多收也不漏收，同时在管理后台给这些模型打上"保底计费"的黄色警示标，提醒尽快补真实价格。

**第二件：修好了对话完全不能用的问题。**
测试时发现所有模型对话都失败，报错只说"没有生成内容"，看不出原因。挖下去发现是代码把上游的真实报错**吞掉了**，导致我们一直在看一个假错误。修好后真实原因立刻现形：上游中继不支持"工具调用"这个功能，而我们三个演示员工全都绑了能力（工具），所以每次对话必然失败。

**第三件（今天最重要的发现）：产品核心能力有 4 类，实际只有 1 类能跑。**
平台的卖点是"数字员工调用各种硅基能力"，能力分 agent / RPA / skill / AI应用 四类。但代码里只实现了 agent 一类，另外三类被调用时会直接报错。演示数据里 5 条能力绑定，**4 条是坏的**。这个必须排到下一步开发。

一句话：计费不再漏钱了，对话能跑了，但"员工调用能力"这个核心卖点目前只有 1/4 是真的。

---

## 二、遇到的问题和解决办法

### 2.1 未配价模型计费为 0（P0，收入漏洞）
- **现象**：`MODEL_PRICING` 只配了 7 个模型，上游有 63 个。未配价模型走到 `calculateCost()` 时返回 `{ costUSD: 0, costCNY: 0 }`，对话完全免费。
- **根因**：`calculateCost()` 对未知 modelId 缺少兜底策略，直接返回 0 而非报错或按保底价计费。
- **解决**：新增 `FALLBACK_PRICING`，取 `MODEL_PRICING` 中各维度最高单价（当前解析为 claude-sonnet-5 的 $3 / $15 per 1M）；新增 `hasPricing(modelId)` 判定；`calculateCost()` 返回值增加 `isFallback` 标记，一路透传到记账（交易描述加「（保底价）」后缀、`metadata.isFallback`）和日志（`[FALLBACK PRICING]` + `logger.warn` 提示补价）。
- **设计取向**：宁可多收也不漏收。多收会被投诉但可退款，漏收是静默失血。

### 2.2 流式对话对所有模型失效，且错误信息是假的（P0，核心阻断）
- **现象**：任何模型发消息都返回 `event: error` → `{"message":"No output generated. Check the stream for errors."}`。裸 curl 打上游却是 200 正常返回。
- **根因（两层）**：
  1. **错误被吞**：AI SDK v7 在 `result.fullStream` 中以 **error chunk** 上报上游错误，而不是 throw。`conversation-stream.service.ts` 的 `switch (chunk.type)` 只处理了 `text-delta` / `tool-call` / `reasoning*`，**没有 `case "error"`**，错误被静默丢弃；随后循环外的 `await result.finishReason` 抛出无信息的 `No output generated`——我们一直在 debug 一个假象。
  2. **真实原因**：加上 error handler 后，后端日志打出真实请求体与响应：
     ```
     tools: [ [Object], [Object] ], tool_choice: 'auto'
     → HTTP 400 {"error":{"message":"Invalid request","type":"invalid_request_error"}}
     ```
     裸 curl 对照确认：无 tools → 200，带 tools → 400。**sub2api 中继不支持 function calling**。而三个 demo 员工全部有能力绑定 → `hasTools=true` → 必然 400。
- **解决**：`switch` 中补 `case "error"`，把 chunk 里的真实 error 抛出交给既有 catch 处理，前端因此能显示有意义的错误文案而非"没有生成内容"。
- **遗留**：sub2api 不支持 tools 属上游能力限制，非代码问题。需要换支持 tools 的中继，或 demo 时只用无绑定员工。

### 2.3 误判导致的过度修复：token 被低估约 70 倍（自己造的坑）
- **现象**：为绕开 2.2 的 400，我直接删掉了 `createOpenAICompatible` 的 `includeUsage: true`。对话恢复后 usage 为空，token 退回字符估算，一次对话 input 只算出 **3**。
- **根因**：删除依据不成立。日志证据显示那次 400 时 `stream_options: undefined`——**光 tools 就足以触发 400，`stream_options` 并未被证明有罪**。而 `includeUsage` 正是让上游返回真实 usage 的开关，删掉等于自断计费精度。同样内容裸 curl 上游实际返回 `prompt_tokens: 211`，估算值 3，**低估约 70 倍**，正是 2.1 要堵的同类漏洞。
- **解决**：改为条件启用 `includeUsage: !hasTools`。无工具会话拿真实 usage 保证计费准确；带工具会话退回估算（反正带 tools 本就走不通）。为此把 `hasTools` 的定义位置从 provider 之后提前到 provider 之前。
- **教训**：绕开报错前先确认"被删的东西"是否真是元凶。日志里 `stream_options: undefined` 这一行当时就在眼前，被我忽略了。

### 2.4 `PATCH /models/:id` 不返回 `hasPricing`（P2，类型不一致）
- **现象**：`listAll()` 加了 `hasPricing`，但 `updateModel()` 直接返回 Prisma 原始对象，响应里没这个字段。前端 `api.patch<PlatformModel>` 声明的 `PlatformModel.hasPricing` 是必填 → 类型撒谎。
- **根因**：改动只覆盖了列表接口，漏了更新接口。
- **解决**：`updateModel()` 返回 `{ ...updated, hasPricing: hasPricing(updated.modelId) }`，与 `listAll` 对齐。
- **注**：非用户可见 bug——前端 mutation 走 `invalidateQueries` 重拉列表，徽章显示一直是对的。属一致性修复。

### 2.5 上游服务两次中断，一次被我误诊（流程问题）
- **现象**：验证中途上游先返回 HTTP 000，后持续 503 `No available accounts`。
- **误诊**：我先断言"上游挂了"，实际是**自己的 shell 引号 bug**——`.env` 里的值带引号，`cut -d= -f2-` 出来没 `tr -d '"'`，curl 收到含字面引号的 URL 所以返回 000。上游当时是好的。
- **第二次**：503 `No available accounts` 是真实的，为服务器升级期间账号池为空。我一度当成"限流"并挂了个等恢复的监控，方向错了——账号池空不会自己恢复。后经用户升级完成后恢复，上游模型数 57 → 9（升级中）→ 63（恢复后）。
- **教训**：断言外部服务故障前，先自检本地请求构造是否正确（对比 `/models` 与 `/chat/completions` 的差异、故意用错 key 看是否 401）。

### 2.6 误启后端第二实例（操作失误）
- **现象**：想读 `MODEL_PRICING`，执行 `node -e "require('./backend/dist/main.js')"`，把整个 Nest 应用又启了一遍（`dist/main.js` 是 webpack 打包入口，require 即启动）。
- **解决**：kill 该 pid，确认 3001 端口仍归属预期进程。
- **教训**：打包产物不能当模块 require，要读常量应查源码或走接口。

### 2.7 上游模型 ID 整体漂移（环境问题，已随上游恢复解决）
- **现象**：服务器升级期间上游模型从 57 个变成 9 个纯 Gemini，命名规则也变（`gemini-3.5-flash-high` → `gemini-3.5-flash`）。跑同步得到 `{"upstreamTotal":9,"added":2,"staled":50}`，`GET /models/enabled` 返回 `[]`，用户端模型选择器全空。
- **验证价值**：这次意外**验证了模型同步的失效标记机制是有效的**——50 个消失的模型被正确标记 `isStale`，用户端自动看不到。
- **现状**：上游恢复到 63 个模型，再次同步 `{"upstreamTotal":63,"added":0,"restored":0,"staled":0}`，模型列表已正常。

---

## 三、技术决策与实现要点

| 决策 | 选择 | 原因 |
|------|------|------|
| 未配价模型计费策略 | 按 `MODEL_PRICING` 最高档收费 | 漏收是静默失血；多收可退款可申诉。二者不对称 |
| 保底价取值方式 | `Math.max(...)` 动态计算，不硬编码 | 价格表增删条目时自动跟随，不会忘记同步 |
| `isFallback` 透传深度 | 返回值 → 交易描述 → metadata → 日志 warn | 资金敏感操作需逐笔可审计，且要能事后 SQL 筛出所有保底计费记录 |
| `includeUsage` 启用范围 | `!hasTools` 条件启用 | 无工具时拿真实 usage（计费准确）；带工具时避开 sub2api 400。二者不可兼得时优先保证"能跑" |
| AI SDK error chunk | 显式 throw 交给既有 catch | 复用已有错误处理与消息持久化逻辑，不新增分支 |
| 定价逻辑的验证方式 | 单元测试而非只靠 E2E | E2E 依赖上游可用性（今天两次中断都卡住验证），单元测试不依赖外部服务 |

**关键代码位置**：
- `backend/src/shared/index.ts` — `FALLBACK_PRICING` / `hasPricing()` / `calculateCost()` 返回 `isFallback`
- `backend/src/modules/conversation/conversation-stream.service.ts` — `case "error"` chunk 处理、`includeUsage: !hasTools`、`recordUsage()` 透传 `isFallback`
- `backend/src/modules/model/model.service.ts` — `listAll()` / `updateModel()` 均返回 `hasPricing`
- `backend/src/shared/pricing.spec.ts` — 10 个用例（新增）

---

## 四、开发方法上的改进

- **假错误要先证伪再 debug**：`No output generated` 让我一开始怀疑上游、怀疑 key、怀疑网络。真正的突破是意识到"这个错误本身可能是假的"，去补 error chunk handler 把真实错误暴露出来。**遇到信息量极低的报错，第一步应是想办法让它变具体，而不是基于它猜。**
- **删代码绕错前先验证归因**：2.3 的 70 倍低估源于"为了让它跑起来先删了再说"。日志里已有反证（`stream_options: undefined`）却被忽略。**改动依据必须来自证据，不能来自"删了就好了"。**
- **断言外部故障前先自检本地**：2.5 的 HTTP 000 是自己的引号 bug。有效自检手段：对比同域不同端点（`/models` vs `/chat/completions`）、故意传错凭据看是否得到预期的 401。
- **让验证摆脱外部依赖**：上游今天中断两次，E2E 全卡。补 `pricing.spec.ts` 后定价逻辑随时可验，并成为长期回归保护。**资金相关逻辑尤其不该只有 E2E 覆盖。**
- **意外是免费的测试用例**：上游模型 57→9 的漂移，顺带验证了模型同步的 `isStale` 机制真实有效——这是刻意造数据很难覆盖的场景。

---

## 五、今日改动概览

| 文件 | 改动 |
|------|------|
| `backend/src/shared/index.ts` | 新增 `FALLBACK_PRICING`、`hasPricing()`；`calculateCost()` 返回值加 `isFallback` |
| `backend/src/modules/conversation/conversation-stream.service.ts` | 补 `case "error"` chunk 处理（修错误被吞）；`includeUsage: !hasTools`；`hasTools` 定义提前；`recordUsage()` 透传 `isFallback` 到描述/metadata/日志 |
| `backend/src/modules/model/model.service.ts` | `listAll()` 与 `updateModel()` 均返回 `hasPricing` 字段 |
| `backend/src/shared/pricing.spec.ts` | **新增**，10 个定价单元测试 |
| `web/src/features/model/use-models.ts` | `PlatformModel` 接口加 `hasPricing: boolean` |
| `web/src/app/(admin)/admin/models/page.tsx` | 未配价模型显示「保底计费」黄色警示徽章 + 表头图例说明 |

**验证结果**：
- ✅ 保底计费 E2E 实跑通过：交易记录 `amount: -0.0010368`、`description: "claude-haiku-4-5-20251001 对话消费（保底价）"`、`metadata.isFallback: true`；手算核对 `3 × $3/1M + 9 × $15/1M = $0.000144 → ×7.2 = ¥0.0010368` 一致
- ✅ 单元测试 10/10 通过
- ✅ `nest build` 通过（webpack）
- ✅ `PATCH /models/:id` 返回 `hasPricing: false`（实测 `gemini-3.5-flash`）
- ✅ 上游恢复后对话正常，usage 真实返回（`prompt_tokens:2, completion_tokens:167`）

**未提交**：以上 6 个文件（5 改 1 新增）尚未 commit。
注：`git diff` 显示 529 行插入，但实质改动约 20 行，其余为 Prettier 自动重排引号/换行；已逐项核对无夹带非预期逻辑。

---

## 六、下一步

### P0 — 能力适配器缺口（今天发现，阻断核心卖点）

产品定位是「数字员工编排硅基能力」，能力分 4 类经统一 `execute()` 接口调用。**实际只有 agent 一类可执行。**

根因在 `backend/src/modules/capability/capability.service.ts:220-229`：
```typescript
const capability = await this.prisma.capability.findUnique({
  where: { id: capabilityId },
  include: { agentConfig: true },        // ← 只 include agentConfig
});
if (!capability.agentConfig) {
  throw new NotFoundException(`No agent config for capability ${capabilityId}`);
}
```
`rpa_configs` / `skill_configs` / `ai_app_configs` 三张表有数据但从未被读取。`AdapterFactory` 也只支持 `OPENCODE` / `COZE` 两个 platform，其余抛 `Unsupported adapter platform`。

演示数据 5 条绑定，4 条调用即报错：

| 员工 | 能力 | 类型 | 状态 |
|------|------|------|------|
| 小海 | 联网搜索 | AGENT | agentConfig 存在 ✅（但受 sub2api 不支持 tools 影响，触达不到）|
| 小海 / 小文 | 营销文案生成 | SKILL | ❌ 无 agentConfig，`execute()` 抛错 |
| 阿析 | 报表数据抓取 | RPA | ❌ 同上 |
| 阿析 | 可视化数据看板 | AI_APP | ❌ 同上 |

**建议优先做 SkillAdapter**：`skill_configs` 已有 `template` / `modelId` / `temperature` / `maxTokens`，实现方式是模板替换 `{{input}}` 后直接调 sub2api 完成推理，**不需要 function calling**——因此能绕开 sub2api 的 tools 限制，是当前唯一能立刻端到端跑通的能力类型。

RPA 需映像道（YINGDAO）账号与对接才有意义；AI_APP 的 `IFRAME` 模式主要是前端嵌入展示，二者可后排。

### P0 — sub2api 不支持 function calling（上游限制，需决策）
带 `tools` 必返 400。影响：所有 agent 类能力无法通过模型的工具调用机制触发。可选项：确认 sub2api 是否可开启 tools 透传 / 换中继 / demo 只用无绑定员工。

### P1 — 补齐新模型价格
上游 63 个模型，`MODEL_PRICING` 仅 7 个。其余全走保底价（按最贵档收 Gemini Flash 的费，偏离实际成本较多）。管理端已有警示徽章提示，但需尽快补真实价格。

### P1 — 提交今天的改动
6 个文件待 commit。建议拆两个 commit：`fix(billing): 保底计费` 与 `fix(conversation): 修复流式错误被吞`，两者关注点不同。

### P2 — 遗留清理
- `DEFAULT_MODEL_ID = "deepseek-v4-flash"` 与 demo 员工的 `modelId` 需确认在当前上游模型列表中仍有效
- 测试数据 `e2e-notools` 员工 + 订阅（本次为绕开 tools 限制而建）待清理
- `web/tsconfig.tsbuildinfo` 是构建产物却被 git 追踪，应移出并加 `.gitignore`
- token 估算公式 `length / 4` 对中文低估 5–10 倍（沿用既有问题，见 `2026-07-25.md` 2.1）
