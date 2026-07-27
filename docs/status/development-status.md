# 硅基人才平台 - 开发状态

> 最后更新：2026-07-27（⚠️ 产品方向调整，Agent 相关工作暂停）

---

## ⚠️ 2026-07-27 产品方向调整（待细化）

与领导开会后确认：**此前的开发方向有偏差**。

- **定位收敛到「人才市场」** —— 平台核心是人才的展示、筛选、交易/匹配，
  而非「订阅数字员工并与之对话」。
- **不做 Agent 相关内容** —— 对话系统、工具调用、能力适配器（Coze / OpenCode /
  Skill / RPA）等 Agent 方向的工作**暂停**，不再往下推进。
- **会话（对话）部分可能砍掉或搁置** —— 待定，尚未决策删除还是保留。

**当前处置**：已完成的 Agent 相关代码**保持原样、不删除**，全部标记为
「⏸️ 已暂停」。这些模块本身是可用且已验证的（见下方模块状态），
若方向再次调整可直接恢复。

**细节待后续讨论**：人才市场的具体范围、要保留/废弃哪些现有模块、
数据模型是否需要重构 —— 均未确定，**不要在讨论前继续开发**。

> 下方「模块状态」「待办事项」中标注 ⏸️ 的条目均属暂停范围，
> 保留记录仅为便于日后恢复或复盘，不代表当前排期。

---

## 总体进度

- [x] Layer 0: 数据库 Schema + Docker Compose
- [x] Layer 1: 认证 & 基础连接
- [x] Layer 2: 用户模块
- [x] Layer 3: 能力管理
- [x] Layer 4: 数字员工
- [x] Layer 5: 订阅 & 对话系统
- [x] 前端脚手架 & 核心页面
- [x] ⏸️ **AI 集成**（流式对话 + 工具调用循环已通）— 方向调整，暂停
- [x] ⏸️ **计费系统**（已完成并验证，含保底计费）— 依附于对话，暂停
- [ ] ⏸️ **能力适配器**（Coze 已端到端验证；其余 3 类未实现）— 暂停
- [ ] **人才市场方向**（待细化后重新拆解）← 新方向
- [ ] 错误处理统一
- [ ] 结构化日志
- [ ] 生产部署

---

## 当前状态

**当前版本**: v0.4.0-alpha
**最新提交**: `fix(coze): 修复 SSE 解析导致回复被内部数据覆盖`
**下一步**: ⏸️ 暂停开发，等人才市场方向细化后重新拆解

**Coze 验证结论（2026-07-27，方向调整前最后一项完成的工作）**
Coze 平台已**端到端跑通** —— 项目首次成功的能力执行。链路：
用户提问 → 模型调用工具 → CozeAdapter → `/v3/chat` → Bot 回复 → 回传用户。
实测 `tool_end {"success":true,"durationMs":12983}`，`tool_executions` 落库
`SUCCESS`，前端收到正确文本。验证过程修掉 3 个只在真实响应下才暴露的 bug
（详见 `docs/test/fix/`）。此结论在方向调整后仍有参考价值：
证明「平台调用外部低代码智能体」这条技术路径是可行的。

**Coze 返回 usage（未接入计费，遗留缺口）**
`conversation.chat.completed` 事件带 `{"token_count":426,"input_count":134,
"output_count":292}`。adapter 未读取，故能力执行的算力消耗未计费。
（此前状态文档称「Coze 无 usage 数据」有误，那是 OpenCode 的情况。）

**关于 sub2api function calling（此前误判，已更正）**
sub2api **支持** function calling，差异在**模型**而非网关。实测：`deepseek-v4-flash`
带 tools 返回 400；`claude-sonnet-5` / `claude-opus-4-8` / `gemini-3.5-flash` /
`gemini-3.5-flash-high` 均正常返回 `finish_reason: tool_calls` 及结构化调用对象。
此前"该中继不支持 tools、可能需换中继"的结论**是错的** —— 真因是默认模型
`deepseek-v4-flash` 恰好不支持。已改为 `gemini-3.5-flash-high`。

**关于模型失效（此前误判，已更正）**
`gemini-3.5-flash-high` 上游一直存在。50 个模型被标 `isStale` 是在上游升级中途
（模型数暂时掉到 9 个）跑同步造成的误标，重新同步已恢复 56 个。
副作用是意外验证了 `isStale` 机制确实有效。

---

## 模块状态

| 模块 | 状态 | 完成度 | 最后更新 | 备注 |
|------|------|--------|----------|------|
| 用户认证 | ✅ 完成 | 100% | 2026-07-24 | JWT + httpOnly cookie，中文错误提示 |
| 用户管理 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 个人设置 |
| 能力管理 | ✅ 完成 | 95% | 2026-07-24 | CRUD + 审核流程 + status 过滤 |
| **能力适配器** | ⏸️ 暂停 | 40% | 2026-07-27 | Coze 已端到端验证（首次成功能力执行）；Skill/RPA/AI_APP 未实现 |
| 数字员工 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 能力绑定 + 发布管理 |
| 订阅系统 | ✅ 完成 | 100% | 2026-07-23 | 订阅/取消/配置 |
| 对话系统 | ⏸️ 暂停 | 95% | 2026-07-27 | SSE 流式 + 工具调用循环修复完毕并验证；方向调整后暂停 |
| 计费系统 | ⏸️ 暂停 | 95% | 2026-07-25 | Token 追踪 + 保底计费 + 用量统计，已 E2E 验证；方向调整后暂停 |
| 工具编排 | ⏸️ 暂停 | 70% | 2026-07-27 | 循环/注册/结构均已验证；Coze 首次成功执行；方向调整后暂停 |
| 前端页面 | ✅ 完成 | 95% | 2026-07-25 | 所有核心页面就绪 |
| **人才市场（新方向）** | 🔲 待定 | 0% | — | 范围未细化，待讨论后重新拆解 |

---

## 最近变更

### 2026-07-27
- **⚠️ 产品方向调整** —— 收敛到「人才市场」定位，不做 Agent 相关内容。
  对话/工具调用/能力适配器全部暂停，代码保留不删。细节待讨论。
- **Coze 端到端验证通过**（方向调整前最后一项完成的工作）
  - ✅ 项目**首次成功的能力执行**：`tool_end {"success":true,"durationMs":12983}`，
    `tool_executions` 落库 `SUCCESS`，前端收到 Bot 正确回复
  - 🐛 修 3 个只在真实响应下暴露的 SSE 解析 bug（最严重的一个会让用户看到
    `{"msg_type":"generate_answer_finish",...}` 而非 Bot 回复）
  - 🐛 `AdapterFactory` 的 `apiKey` 强制校验使 `COZE_PAT` 环境变量回落永不生效
  - ✅ 新增 `coze.adapter.spec.ts`（5 个用例，含 verbose 覆盖回归）
  - 📌 发现 Coze **返回 usage 数据**但未接入计费（遗留缺口）
- **工具调用循环 4 个 bug 修复**
  - 工具名 `-`/`_` 归一（上游把 `-` 规范成 `_` 回传导致查表 miss）
  - AI SDK v7 字段变更：`args`→`input`、`result`→`output:{type,value}`
  - TOOL 消息存可读文本却用 `JSON.parse` 读回 → 带工具调用的会话无法续聊
  - 用户消息重复入队（模型每轮看到两遍同样的问题）
  - OpenCode adapter 加 10s fetch 超时（原先单轮可挂 2 分钟以上）
- **默认模型改为 `gemini-3.5-flash-high`**（`deepseek-v4-flash` 不支持 tools）
- **接入 code-review-graph**（pre-commit 自动风险分析 + 测试缺口报告）
- **更正两处此前误判**：sub2api 支持 function calling（差异在模型）；
  50 个模型的 `isStale` 是上游升级中途跑同步造成的误标

### 2026-07-25（下半日：保底计费 + 流式修复）
- **保底计费**（堵住收入漏洞，已验证）
  - ✅ `FALLBACK_PRICING`：未配价模型按 `MODEL_PRICING` 最高档计费（原为 ¥0 = 免费对话）
  - ✅ `hasPricing()` + `calculateCost()` 返回 `isFallback`，透传到交易描述/metadata/日志
  - ✅ 管理端「保底计费」警示徽章（`/admin/models`）
  - ✅ 新增 `backend/src/shared/pricing.spec.ts`（10 个用例，不依赖上游）
  - ✅ E2E 实测：`¥0.0010368` 与手算一致，`metadata.isFallback: true`
- **流式对话修复**（P0 阻断）
  - 🐛 AI SDK v7 的 error chunk 未处理 → 上游真实错误被吞，只暴露假错误 `No output generated`
  - ✅ 补 `case "error"` 后定位真因：**sub2api 不支持 function calling**，带 `tools` 必返 400
  - ✅ `includeUsage: !hasTools` 条件启用（避免自断计费精度，见专题 2.3）
- **发现**：能力适配器 4 类仅 AGENT 可执行，demo 5 条绑定 4 条报错 → 已列为下一步 P0
- 详见 [progress/2026-07-25-pricing-fallback-and-streaming-fix.md](../progress/2026-07-25-pricing-fallback-and-streaming-fix.md)

### 2026-07-25（上半日）
- **计费系统开发完成**（待验证）
  - ✅ 数据库 schema: Message 表添加 `inputTokens` / `outputTokens` 字段
  - ✅ 价格表 + 成本计算: `shared/index.ts` - `MODEL_PRICING` + `calculateCost()`
  - ✅ 计费记账: `conversation-stream.service.ts` - `recordUsage()` 方法
  - ✅ 用量统计 API: `GET /users/me/compute-usage`
  - ✅ 前端用量统计页面: `/usage` - 汇总卡片 + 交易记录表
  - ✅ 侧边栏入口: "用量统计" 菜单项
  - ✅ AI SDK v7 usage 字段兼容处理（promptTokens / inputTokens）
  - 🐛 修复: 对话重复显示问题（清空 pendingUser）
  - 📝 创建端到端测试指南: [E2E-Test-Guide-Billing.md](../test/E2E-Test-Guide-Billing.md)

- **AI 集成完善**
  - ✅ AI SDK v7.0.35 集成完成
  - ✅ 流式对话 + 工具调用
  - ✅ 异常处理增强（捕获流消费异常）
  - ✅ 变量作用域修复（accumulatedText 移到循环外）

### 2026-07-24
- **E2E 测试问题修复**（5 个阻断级问题）
  - P0: 修复员工详情页崩溃（`industry.length` undefined）
  - P1: 移除工作台 TODO 占位文本
  - P1: 后端能力 API 增加 `status` 参数支持
  - P1: 添加移动端响应式布局（汉堡菜单）
  - P2: 认证错误提示本地化为中文
  - 详见 [progress/2026-07-24-e2e-fixes.md](../progress/2026-07-24-e2e-fixes.md)

- **环境配置更新**
  - 配置 sub2api 生产端点 `https://longdaoai.cn/v1`
  - 添加 `DEFAULT_MODEL_ID=deepseek-chat`
  - 添加 Coze 集成配置占位

- **文档重组**
  - 保留 `progress/` 用于每日开发记录
  - 重组 `test/` 为 `guides/`、`plans/`、`reports/`、`fix/`
  - 创建 `docs/README.md` 文档导航

### 2026-07-23
- **前端核心页面开发完成**
  - 用户端：登录、注册、工作台、员工广场、订阅管理、对话中心、个人设置
  - 管理端：仪表盘、能力审核、员工管理
  - 详见 [progress/2026-07-23.md](../progress/2026-07-23.md)

- **后端 Layer 5 完成**
  - 订阅系统（CRUD + 状态管理）
  - 对话系统（SSE 流式 + 消息持久化 + 工具执行记录）
  - Redis 分布式锁

更多历史记录见 [progress/](../progress/)

---

## 技术栈

### 后端
- **框架**: NestJS 10.4 + Prisma 6 + PostgreSQL 16
- **认证**: JWT (1h access + 7d refresh) + bcrypt
- **缓存**: Redis 7 + ioredis
- **AI**: Vercel AI SDK 7 + sub2api 中转

### 前端
- **框架**: Next.js 15 App Router + React 19
- **UI**: Tailwind CSS 3.4 + Shadcn/ui
- **状态**: TanStack Query v5 (server) + Zustand v5 (client)
- **表单**: react-hook-form + zod

### 开发工具
- **Monorepo**: pnpm workspace
- **类型**: TypeScript 5.7 (strict mode)
- **容器**: Docker Compose (PostgreSQL + Redis)

---

## 待办事项

### 当前唯一待办
- [ ] **细化人才市场方向**（与领导确认范围后再拆解任务）
  - 需明确：平台核心场景是什么（展示 / 筛选 / 匹配 / 交易？）
  - 需决策：会话（对话）模块砍掉还是搁置
  - 需评估：现有 14 张表里哪些可复用、哪些需重构
  - **在此之前不要继续开发**

---

### ⏸️ 已暂停（Agent 方向，方向调整前的待办，保留备查）

> 以下条目在 2026-07-27 方向调整后全部暂停。代码保持原样未删除，
> 若方向再次调整可直接恢复。

**原 P0**
- [ ] ⏸️ SkillAdapter（`skill_configs` 已有 `template`/`modelId`/`temperature`/`maxTokens`；
      实现方式：模板替换 `{{input}}` → 调 sub2api，不需 function calling）
- [ ] ⏸️ `capability.service.execute()` 支持 4 类能力
      （`capability.service.ts:220-229` 只 `include: { agentConfig: true }`；
      `rpa_configs`/`skill_configs`/`ai_app_configs` 有数据但从未被读取）
- [ ] ⏸️ OpenCode adapter 状态判断修复（4 行，当前会把成功执行误判超时）
      **不要按 `docs/对接/` 的契约重写** —— 该文档与真实服务不符

**原 P1**
- [ ] ⏸️ Coze usage 接入计费（Coze 已返回 token 数据，adapter 未读取）
- [ ] ⏸️ 补齐新模型价格表（上游 63 个，`MODEL_PRICING` 仅 7 个）
- [ ] ⏸️ Coze 能力导入 UI（管理端）
- [ ] ⏸️ 员工创建表单增加模型选择和系统提示词
- [ ] ⏸️ OpenCode Skills Service 部署 + 确认真实 template 名
- [ ] ⏸️ OpenCode 服务鉴权（服务端无任何 API 认证）
- [ ] ⏸️ RPA 适配器（需影刀 YINGDAO 账号与对接）
- [ ] ⏸️ AI_APP 适配器（`IFRAME` 模式主要是前端嵌入展示）

**原 P2（部分与方向无关，方向定了再排）**
- [ ] 单元测试补充（订阅系统）
- [ ] 性能优化（Redis 缓存）
- [ ] 生产环境配置（环境变量、日志、监控）

---

## 已知问题

### 功能缺口

> ⏸️ 第 1、2 项属 Agent 方向，2026-07-27 起暂停，保留备查。

1. ⏸️ **能力适配器仅 Coze 可用**
   - Coze 已端到端验证；SKILL / RPA / AI_APP 被调用即抛 `No agent config for capability X`
   - `capability.service.ts:220-229` 只 `include: { agentConfig: true }`
2. ⏸️ **OpenCode 集成缺陷**（待服务部署后修）
   - `opencode.adapter.ts` 端点正确（`/jobs` 系列），但**状态判断有 4 处错误**：
     - 成功判：`'completed'` ✅ / `'done'` ❌（不存在）; 主成功态是 `'succeeded'`，**缺失 → 成功任务被误判超时**
     - 失败判：`'cancelled'`（双 l）❌，服务端是 `'canceled'`（单 l）→ **取消永远轮询到超时**
     - 缺处理 `'retrying'` / `'paused'`（会误判为超时）
   - `fetchOutput` 取 `files[0]` 按顺序取第一个，应优先找结构化结果文件（`submission-result.json`）
   - ⚠️ **契约文档 `docs/对接/OpenCode执行后端-协作与接口契约.md` 与真实服务不符**
     文档写的是 `/v1/runs`，真实服务是 `/jobs`；**不要按该文档重写 adapter**
   - `skillName` 需对应服务端已注册 template（如 `md2wechat`）；demo 数据填的 `web-search` 不在列表
   - 服务端**没有 API 鉴权**（`.env` 的 `OPENCODE_API_TOKEN` 服务端不校验）；服务暴露在内网 `10.50.10.29:4100`
   - 没有 usage 数据，能力执行的算力消耗无法计量
     （注：**Coze 有** usage，此条仅指 OpenCode）
3. ⏸️ **Coze usage 未接入计费** — `conversation.chat.completed` 返回
   `{"token_count":426,"input_count":134,"output_count":292}`，adapter 未读取，
   故 Coze 能力执行的算力消耗未计费（与保底计费同类的漏收风险）
4. **能力版本管理** — Schema 有 `CapabilityVersion` 表，未实现版本切换逻辑
5. **秘钥加密** — `AgentConfig.apiKey` 明文存储（生产前需加密）
   ⚠️ 当前 `.env` 的 `COZE_PAT` 为验证时配置的真实令牌，建议轮换
6. ⏸️ **价格表覆盖率低** — 上游 63 个模型仅 7 个配价，其余按最贵档保底计费

### 技术债
1. Layer 5 单元测试缺失（18/18 通过的是 Layer 4）
2. 前端 E2E 自动化测试未实现
3. 错误日志未统一（部分模块缺少结构化日志）
4. token 估算公式 `length / 4` 对中文低估 5–10 倍（仅在带工具会话生效）
5. `web/tsconfig.tsbuildinfo` 是构建产物却被 git 追踪，应移出并加 `.gitignore`
6. 验证用测试数据待清理（方向调整后可能直接废弃，暂不动）：
   - `e2e-notools` 员工 + 订阅（为绕开 tools 限制临时创建）
   - `coze-verify-emp` 员工 + `coze-verify-bot` 能力 + 订阅（Coze 验证用）
7. `tool-message-shape.spec.ts` 内联复制了 `ai@7.0.35` 的 schema（`ai` 是 ESM-only，
   Jest 为 CJS 无法直接 import）。能防自己改回旧字段，**防不住 SDK 未来改字段名** —
   升级 `ai` 包时需人工核对 `dist/index.js` 的 `toolCallPartSchema` / `toolResultPartSchema`
8. OpenCode adapter 的 `fetchWithTimeout`（10s）与未配置守卫**无测试覆盖**
   （code-review-graph 报 risk 0.75，14 处 test gap）

---

## 里程碑

- ✅ **2026-07-22**: Layer 0 完成（数据库 + Docker）
- ✅ **2026-07-23**: Layer 1-4 完成（后端核心 API）
- ✅ **2026-07-23**: Layer 5 完成（订阅 + 对话系统）
- ✅ **2026-07-23**: 前端脚手架 + 核心页面
- ✅ **2026-07-24**: E2E 测试问题修复
- ✅ **2026-07-25**: AI 集成完成（SSE 流式对话 + 工具调用）
- ✅ **2026-07-25**: 计费系统完成（Token 追踪 + 用量统计）
- ✅ **2026-07-25**: 保底计费 + 流式错误修复（含 10 个定价单元测试）
- ✅ **2026-07-27**: 工具调用循环 4 个 bug 修复 + 默认模型改为支持 tools 的模型
- ✅ **2026-07-27**: 接入 code-review-graph 知识图谱（pre-commit 风险分析）
- ✅ **2026-07-27**: Coze 端到端验证通过（项目首次成功的能力执行）
- ⏸️ **2026-07-27**: **产品方向调整 —— Agent 方向暂停**，收敛到人才市场定位
- 📅 **下一步**: 细化人才市场方向（范围未定，待讨论）
- ⏸️ ~~SkillAdapter + `execute()` 四类分派 → OpenCode 联调~~（Agent 方向，已暂停）

更多里程碑详情见 [milestones/](./milestones/)

---

## 快速链接

- [需求与架构规格书](../architecture/硅基人才平台-需求与架构规格书-v2.md)
- [前端设计文档](../architecture/前端设计文档-v1.md)
- [AI 集成实施计划](../plans/AI-Integration-Implementation-Plan.md)
- [E2E 测试指南](../test/guides/E2E-TEST-GUIDE.md)
- [API 文档](http://localhost:3001/api/docs) (本地开发)
