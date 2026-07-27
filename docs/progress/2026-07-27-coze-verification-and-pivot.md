# 2026-07-27 Coze 端到端验证 + 产品方向调整

> 本日主线：修工具调用循环 → Coze 平台实际验证（首次成功的能力执行）→ 产品方向调整，Agent 方向暂停
> 参与模块：`conversation-stream` `capability/adapters` `shared` + 前端 `models`
> 状态：Coze 验证通过并已提交；**方向调整后 Agent 相关工作全部暂停**

---

## 一、写给老板（通俗版）

今天前半天把「员工调用外部工具」这条链彻底打通了，后半天方向变了。

**打通的部分**：之前平台虽然能聊天，但「员工调用一个外部能力去干活」从来没有真正成功过一次。今天先修掉了 5 个挡路的 bug，然后拿真实的扣子（Coze）账号做了实测 —— **平台第一次成功地让员工调用外部智能体并把结果返回给用户**。整个链路耗时 19 秒，其中扣子那边执行 13 秒。

**过程中发现一个会直接影响用户体验的严重问题**：扣子返回答案之后，还会再发几条内部数据（相当于"日志"）。我们的代码没做区分，把最后那条内部数据当成了答案，**用户看到的会是一段 JSON 代码而不是机器人的回复**。这个 bug 只有拿真账号打真接口才会暴露，靠模拟测试永远发现不了。

**方向调整**：下午开会确认，产品定位要收敛到「人才市场」，不做 Agent（智能体）相关的内容，对话功能可能砍掉或搁置。所以上面这些成果暂时用不上了。代码我全部保留没删，标记成"已暂停"，方向如果再变可以直接捡回来。

一句话：技术上证明了「平台能调用外部低代码智能体」这条路可行，但产品方向变了，这条路先不走。

---

## 二、遇到的问题和解决办法

### 2.1 Coze 回复被内部数据覆盖（P0，用户可见）
- **现象**：真实调用 Coze 后，adapter 返回的不是 Bot 回复，而是
  `{"msg_type":"generate_answer_finish","data":"{\"finish_reason\":0...}"}`。
- **根因**：Coze 在 `type='answer'` 的消息完成后，**还会再发若干 `type='verbose'`
  的消息**（`knowledge_recall`、`generate_answer_finish`），它们同样是
  `role='assistant'` 且带 `content`。原实现对所有 `role='assistant'` 做
  **覆盖式赋值** `output = event.content`，于是最后那条 verbose 的 JSON
  把真正的答案冲掉了。
- **解决**：按 `type` 过滤，只处理 `type==='answer'`；按事件名区分累加与覆盖
  （`message.delta` 累加、`message.completed` 覆盖）。
- **验证方式**：把真实响应存盘，写脚本用修复前/后的逻辑各重放一次 ——
  修复前返回 JSON 垃圾，修复后返回「未找到相关知识」。**这是本次最有价值的
  验证手段**：不依赖服务可用性，且能证明"修复确实改变了行为"，而不只是"编译通过"。

### 2.2 增量解析分支是死代码（P1）
- **现象**：流式片段从未被累加。
- **根因**：代码判 `event.delta`，但 Coze 真实字段是 `event.content`，该分支永不命中。
  之所以功能看起来"还能用"，是因为 2.1 那个覆盖式赋值恰好在最后一条 answer
  完整消息时把全文赋上了 —— **靠一个 bug 掩盖了另一个 bug**。
- **解决**：统一读 `content` 字段。

### 2.3 结束事件判断失效（P2）
- **现象**：`event: done` 分支从未命中，只能靠 `data:"[DONE]"` 兜底。
- **根因**：Coze 真实格式是 `event:done`（**冒号后无空格**），代码判的是 `event: done`。
- **解决**：解析 `event:` 行并跨行记录当前事件名（Coze 把事件名放在 data 行之前的
  独立一行，这也是 2.1 修复所必需的信息）。

### 2.4 AdapterFactory 的守卫使环境变量回落永久失效（P1）
- **现象**：`agent_configs.apiKey` 为空时报 `Coze adapter requires apiKey (PAT)`，
  即使 `.env` 里已配 `COZE_PAT`。
- **根因**：`AdapterFactory` 有 `if (!config.apiKey) throw`，在适配器**创建之前**
  就抛错，导致 `CozeAdapter` 内部已写好的 `config.apiKey || process.env.COZE_PAT`
  回落逻辑永远走不到。
- **解决**：移除工厂里的该校验，把"凭据是否可用"的判断交给适配器自己
  （它本来就有完整的兜底与错误提示）。

### 2.5 工具调用循环 4 个 bug（P0，阻断所有能力类型）
第一次跑工具调用 E2E 时暴露，与 Coze 无关，任何能力类型都会撞上：

| 问题 | 后果 |
|---|---|
| 工具名 `-`/`_` 不匹配：发出 `demo-cap-search`，Anthropic/Gemini 把 `-` 规范成 `_` 后回传 `demo_cap_search`，查表 miss | 每次调用都报"未找到或未绑定" |
| AI SDK v7 把 `args` 改名 `input`、`result` 改成 `output:{type,value}` | 第二轮抛 `InvalidPromptError`，整轮失败 |
| TOOL 消息存 `🔧 工具: …` 可读文本，`loadMessages` 却用 `JSON.parse` 读回 | 带工具调用的会话**无法续聊**，重载必崩 |
| 用户消息先落库，`loadMessages` 读出后又 push 一次 | 模型每轮看到两条相同用户消息 |

另修 OpenCode adapter 无 fetch 超时（未配置时连默认 `localhost:4100` 挂起，
单轮可拖 2 分钟以上；加 10s `AbortSignal.timeout` 后同样场景 37 秒正常完成）。

### 2.6 第一组 Coze 凭据调不通（环境问题，非代码）
- **现象**：`bot_id=7594729177505431590` 返回 `4200 does not exist`。
- **诊断路径**：PAT 能成功调 `/v1/workspaces`（说明鉴权有效，否则应为 401）
  → 调 `/v1/space/published_bots_list` 返回 `{"space_bots":[],"total":0}`
  → 判定：该空间**没有任何 Bot 发布到 API 渠道**，而非 bot_id 打错。
- **结论**：Coze API 只能看见已发布到「Agent as API」渠道的智能体。
  换用已发布的 Bot（`7665566040915066880`「活动知识检索」）后立即通过。

---

## 三、技术决策与实现要点

| 决策 | 选择 | 原因 |
|------|------|------|
| Coze SSE 过滤策略 | 按 `type==='answer'` 白名单过滤 | verbose 类型未来可能新增子类型，白名单比黑名单安全 |
| delta 与 completed 的区分 | 解析 `event:` 行记录事件名 | Coze 的 payload 内部无"是否完整"标志，只能靠事件名判断 |
| 凭据回落位置 | 放适配器，工厂不校验 | 工厂只负责"造对象"，凭据可用性属运行时关注点 |
| 验证手段 | 真实响应存盘 + 修复前后重放对比 | 不依赖上游可用性；且能证明行为真的变了，而非仅编译通过 |
| 工具名归一 | 主动统一为下划线 | 上游会把 `-` 规范成 `_`，与其被动适配不如两侧同源 |
| Agent 代码处置 | 保留不删，标记 ⏸️ | 已验证可用，方向若再变可直接恢复；删除是不可逆操作 |

**关键代码位置**：
- `backend/src/modules/capability/adapters/coze.adapter.ts` — `parseSseStream()`
- `backend/src/modules/capability/adapters/coze.adapter.spec.ts` — 5 个用例（新增）
- `backend/src/modules/capability/adapters/adapter.factory.ts` — 移除 apiKey 守卫
- `backend/src/modules/conversation/conversation-stream.service.ts` — `toToolName()`、
  `case "error"`、TOOL 消息读写、`includeUsage: !hasTools`
- `backend/src/modules/conversation/tool-message-shape.spec.ts` — v7 字段名回归（新增）

---

## 四、开发方法上的改进

- **真实调用不可替代**：2.1 这个"用户看到 JSON 而非回复"的 bug，只有拿真账号打真
  接口才会暴露。它的成因（answer 之后还有 verbose 消息）是任何凭想象写的 mock
  都不会包含的。**对接第三方平台时，先抓一份真实响应存盘，再据此写测试。**
- **一个 bug 可能掩盖另一个**：2.2 的死代码之所以长期没被发现，是因为 2.1 的
  覆盖式赋值恰好把全文赋上了。修完 2.1 才让 2.2 显形。**功能"看起来能用"不等于
  实现是对的。**
- **诊断外部故障要分层排除**：2.6 的定位路径（先验鉴权 → 再验资源可见性 → 最后
  才怀疑参数）比直接猜"ID 打错了"高效得多。同理，上一次误判"上游宕机"实际是
  自己的 shell 引号 bug —— **断言外部故障前先自证本地请求构造正确**。
- **让验证摆脱外部依赖**：本次把真实响应存盘后重放，以及此前给定价逻辑补单元测试，
  都是同一思路。上游服务当天中断过两次，若验证全靠 E2E 会被完全阻塞。
- **方向变更时用标记而非删除**：⏸️ 标记保留了完整上下文（为什么做、验证到什么程度、
  遗留什么坑），删除则会让日后恢复时重新踩一遍同样的坑。

---

## 五、今日改动概览

| 文件 | 改动 |
|------|------|
| `capability/adapters/coze.adapter.ts` | `parseSseStream` 重写：按 type 过滤、事件名区分 delta/completed、修 `event:done` 判断 |
| `capability/adapters/coze.adapter.spec.ts` | **新增**，5 个用例（含 verbose 覆盖回归） |
| `capability/adapters/adapter.factory.ts` | 移除 apiKey 强制校验，让 `COZE_PAT` 回落生效 |
| `capability/adapters/opencode.adapter.ts` | 加 `fetchWithTimeout`（10s）+ 未配置时明确报错 |
| `conversation/conversation-stream.service.ts` | 工具名归一、v7 字段名、TOOL 消息读写、去重复入队 |
| `conversation/conversation.types.ts` | `args`→`input`、`result`→`output:{type,value}` |
| `conversation/tool-message-shape.spec.ts` | **新增**，7 个用例锁定 v7 字段名 |
| `shared/index.ts` · `web/src/lib/models.ts` · `.env` · `.env.example` | 默认模型改 `gemini-3.5-flash-high` |
| `docs/status/development-status.md` | 方向调整标记 + 修正虚高完成度 |
| `docs/对接/OpenCode…契约.md` | 顶部加警示：本文与真实服务不符 |

**验证结果**：
- ✅ Coze 端到端：`tool_end {"success":true,"durationMs":12983}`，
  `tool_executions` 落库 `SUCCESS`，前端收到「未找到相关知识」
- ✅ 真实响应重放：修复前返回 JSON 垃圾 → 修复后返回正确回复
- ✅ 单元测试 40/40 通过（新增 12 个）
- ✅ `nest build` 通过；web `tsc --noEmit` 通过

---

## 六、下一步

### 唯一待办：细化人才市场方向

2026-07-27 与领导开会确认**此前方向有偏差**，需重新界定：

- 平台核心场景到底是什么（人才展示 / 筛选 / 匹配 / 交易？）
- 会话（对话）模块**砍掉还是搁置** —— 未决策
- 现有 14 张表哪些可复用、哪些需重构
- 「碳基员工 / 硅基能力」这套概念模型是否还成立

**在讨论清楚之前不要继续开发。**

### ⏸️ 已暂停（Agent 方向，保留备查）

代码保持原样未删除，详细清单见
`docs/status/development-status.md` 的「已暂停」段落。要点：

- SkillAdapter、`capability.service.execute()` 四类分派
- OpenCode adapter 4 处状态值错误（`'succeeded'` 缺失会把成功执行误判超时）
- Coze usage 未接入计费（Coze **有** usage 数据：`token_count/input_count/output_count`，
  adapter 未读取 → 能力执行的算力消耗未计费）
- 63 个上游模型仅 7 个配价

### 与方向无关、仍需处理

- ⚠️ **`.env` 里的 `COZE_PAT` 是验证时配置的真实令牌，建议轮换**
  （本次对话中贴出过两个 PAT，均应停用）
- 验证用测试数据（`coze-verify-emp` / `coze-verify-bot` / `e2e-notools`）
  方向定了再决定是清理还是废弃
- `web/tsconfig.tsbuildinfo` 是构建产物却被 git 追踪
- `tool-message-shape.spec.ts` 内联复制了 `ai@7.0.35` 的 schema
  （`ai` 为 ESM-only，Jest 是 CJS 无法直接 import），升级 `ai` 包时需人工核对
