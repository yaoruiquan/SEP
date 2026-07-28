# 硅基人才平台 - 开发状态

> 最后更新：2026-07-28（**P1 企业组织层完整落地** —— 含授权与三个管理页面）

---

## ⚠️ 2026-07-27 产品方向调整（待细化）

依据：`杭州城投未来之星C2_会议纪要.md` + `硅基员工平台设计方案.md`（2026-07-27）

### 产品定位重新表述

平台是**面向企业**的「硅基员工人才市场 + 企业组织中控 + 员工运行/适配层」，
**以企业组织为核心**，而非个人订阅数字员工并聊天。

### 停什么、留什么（此处曾误记，已更正）

| | 结论 |
|---|---|
| **Agent 编排** | ⏸️ **停** —— 多员工协同编排、指挥官自动拆解，后置 |
| **会话（聊天）** | ⏸️ **停** —— 本期不做；是否改造成「任务」暂不决策 |
| **能力适配器** | ✅ **继续** —— 但**重新定位**：从"核心卖点"降为"统一接入底座" |

> ⚠️ 曾在本文档把适配器标为「暂停」，**这是错的**。会议纪要第 91 条明确：
> 「现有适配器/封装层工作**有价值**，但需回到平台总体架构中重新定位，
> 明确其服务对象是不同类型的硅基员工和外部工具统一接入」；
> 设计方案 §10.1「本期必须完成」亦列有「一种或两种 Agent/Skill 形态的适配接入」
> 与「单员工任务提交、状态查询和结果返回」。
> 即：**Agent 不是产品定位，但仍是 MVP 必需的执行底座**。

### 最大缺口：企业组织层完全缺失

现有 27 个 Prisma 模型中，企业组织相关**一个都没有**，且现有模型是
**单用户视角**，与「以组织为核心」直接冲突：

| MVP 必需（设计方案 §10.1） | 现状 |
|---|---|
| 企业 Enterprise | ❌ 无 |
| 部门 Department | ❌ 无 |
| 企业成员 + 岗位/角色 | ❌ 无（`User.role` 仅全局 USER/ADMIN/CONTRIBUTOR）|
| 员工模板 ↔ 企业实例分离（§6.4）| ❌ 无，`DigitalEmployee` 一张表兼任两者 |
| 任务 Task（§6.5）| ❌ 无，只有 `ConversationSession` |
| 成员↔硅基员工授权 | ❌ 无 |
| 跨部门调用申请/审批 | ❌ 无 |
| 企业知识库 | ❌ 无 |

需改造主体的既有模型：
```
Subscription        { userId → enterpriseId }
ComputeAccount      { userId → enterpriseId }  // 套餐含算力额度，应挂企业
ConversationSession { userId → 任务归属企业/部门/项目 }
```

**这是数据模型层面的重构，不是加几张表。** 设计方案 §11 把「建立基本对象」
列为第一阶段，正是此因。

### 待确认

- 「原有汇聚人才 MVP」不存在（纪要行动项 #9 提及），但有一个前端可作思路参考，
  后续讨论
- 人才市场的具体范围、现有模块的保留/废弃清单 —— 未定
- **除已明确的行动项外，不要在讨论前继续开发**

---

## 总体进度

- [x] Layer 0: 数据库 Schema + Docker Compose
- [x] Layer 1: 认证 & 基础连接
- [x] Layer 2: 用户模块
- [x] Layer 3: 能力管理
- [x] Layer 4: 数字员工
- [x] Layer 5: 订阅 & 对话系统
- [x] 前端脚手架 & 核心页面
- [x] ⏸️ **会话/聊天**（流式对话已通）— 本期不做
- [x] **计费系统**（保底计费 + 汇率可配置，已验证）— 保留，MVP 需算力计量
- [x] **能力适配器**（Coze 已端到端验证）— 保留，重新定位为统一接入底座
- [ ] ⏸️ **Agent 编排**（多员工协同）— 后置
- [x] **企业组织层** — P0 基座 ✅ + P1 部门/成员/实例管理 ✅（进行中）
- [ ] **人才市场**（员工目录/详情/招聘/运行环境绑定）← 新方向主线
- [ ] 错误处理统一
- [ ] 结构化日志
- [ ] 生产部署

---

## 当前状态

**当前版本**: v0.6.0-alpha
**最新提交**: `feat(frontend): 部门管理、成员管理、我的员工三页面`
**下一步**: P2 —— 人才市场主线（员工目录/详情/订阅入口）

**P1 完整交付（2026-07-28）**

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0 | 6 张新表 + 订阅/算力账户主体改企业 + 多租户隔离基座 | E2E 11/11 |
| P1-1 | 企业自助注册 + 部门树 + 成员管理（9 接口） | 单测 94/94 · E2E 21/21 |
| P1-2 | 员工实例管理（5 接口，版本锁定 + 状态机 + 授权保留） | 单测 22/22 · E2E 12/12 |
| P1-3 | 员工授权（4 接口）+ 前端路由组重构 + 部门/成员/我的员工三页面 | 单测 131/131 · E2E 11/11 · next build 20 页 |

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
| **能力适配器** | ✅ 保留 | 40% | 2026-07-27 | Coze 已端到端验证（首次成功能力执行）；Skill/RPA/AI_APP 未实现。**MVP 需 1-2 种形态** |
| 数字员工 | ✅ 已分离 | 100% | 2026-07-28 | `DigitalEmployee` 为市场模板（带 `version`），`EmployeeInstance` 为企业实例（设计方案 §6.4）|
| 订阅系统 | ✅ 已改造 | 100% | 2026-07-28 | 主体已改 enterprise，`@@unique([enterpriseId, employeeId])` |
| 会话系统 | ⏸️ 暂停 | 95% | 2026-07-27 | SSE 流式 + 工具循环已修复验证；**本期不做** |
| 计费系统 | ✅ 保留 | 97% | 2026-07-27 | 保底计费 + 汇率可配置 + 累计消费修正；`ComputeAccount` 主体已改企业 |
| 工具编排 | ✅ 保留 | 70% | 2026-07-27 | 单员工工具调用已验证；**多员工编排后置** |
| **企业组织层** | ✅ P1 完成 | 80% | 2026-07-28 | P0+P1-1+P1-2+P1-3 全部落地；授权管理界面、实例详情页留 P2 |
| 前端页面 | ⚠️ 部分复用 | 95% | 2026-07-25 | 现有为个人视角，企业组织相关页面待建 |
| **人才市场** | 🔲 未开始 | 0% | — | 员工目录/详情/招聘/运行环境绑定 |

---

## 最近变更

### 2026-07-28
- **P1 第一块：部门树 + 成员管理**（9 接口，`feat(enterprise): 7c29305`）
  - ✅ `DepartmentService` —— 部门树（含环检测 + 跨企业挂载防护）、增改删（不级联）
  - ✅ `MemberService` —— 列表、代建账号（事务内同时建 User）、改角色、移出
  - 安全守卫：最后一名管理员不可移除/降级；不能自己降自己；越权 404
  - 单测 94/94；E2E 21/21（含跨企业隔离）

- **P1 第二块：员工实例管理**（5 接口，`feat(enterprise): f4376a6`）
  - ✅ `InstanceService` —— 列表（含 `upgradeAvailable`）、创建（校验订阅有效性）、
    改名/换部门/改配置、状态流转、主动升级
  - 版本锁定：创建时锁 `templateVersion`，模板发新版仅提示；升级返回
    `configReviewRequired` 提示复核，**不自动迁移 config**（版本间配置项可能变动）
  - 停用/回收不删 `EmployeeGrant`（恢复后授权继续有效）；REVOKED 是终态
  - 状态机：`PENDING_ACTIVATION → ACTIVE / REVOKED`、`ACTIVE ↔ SUSPENDED`、
    `SUSPENDED → ACTIVE / REVOKED`、`REVOKED`（终态）
  - 单测 22/22；E2E 12/12（含跨企业隔离 2 项、状态终态 2 项、幂等 1 项）

- **P0 企业组织基座**（`feat(enterprise): P0`）
  - 6 张新表：Enterprise / Department / EnterpriseMember / EmployeeInstance /
    EmployeeGrant / AccessRequest
  - `Subscription` / `ComputeAccount` 主体改 enterprise；`DigitalEmployee` 加 `version`
  - `EnterpriseContextService` 多租户单一数据源；注册事务（User + Enterprise + Member + ComputeAccount）
  - `ZodValidationPipe` —— Zod DTO 无法依赖 class-validator，新增运行时校验管道
  - E2E 11/11（含双企业种子数据隔离验证）

- **tsc 类型推断 OOM 根因修复**（`fix(build): b040f3b`）
  - AI SDK v7 的 `tool()` + `generateText` 泛型 + Zod schema 三件事合起来触发
    TS 递归类型展开，单文件就能把 tsc 顶到 3GB heap 后 OOM
  - 受影响文件：`digital-employee.runner.ts`（动态 schema）、`agent-runtime-test.service.ts`（静态 schema）
  - 修法：用 `jsonSchema()` 替换 `z.object()` + `tool()` 组合，走 AI SDK 零推断路径
  - 全量 tsc：OOM → **2.2 秒**；`nest build` 1.7 秒；单测 116/116 不变

### 2026-07-27
- **⚠️ 产品方向调整** —— 收敛到「企业级硅基员工人才市场 + 组织中控」。
  **停**：Agent 编排（多员工协同）、会话/聊天。
  **留**：能力适配器（重新定位为统一接入底座）、计费。
  代码全部保留不删。企业组织层是最大缺口。细节待讨论。
- **汇率与算力计费复核**（会议行动项 #1，已完成）
  - ✅ 汇率改为可配置：管理端设置 > `.env` > 默认 7.2；实测改 7.5 即刻生效
  - ✅ 交易 `metadata.rate` 记录当时汇率（汇率变动后旧账单仍可复核）
  - 🐛 修复「累计消费」只统计最近 100 条 → 超量后静默漏算
  - 🐛 修复金额统计依赖 `metadata` 完整性 → 无 metadata 的消费被漏掉
  - ✅ `parseUsdToCnyRate()` 防非法配置写出 NaN 账单
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

### 已完成的会议行动项
- [x] **#1 复核汇率、人民币显示和算力计费配置**（2026-07-27 完成）
  - 汇率改为可配置（管理端设置，优先级：数据库 > `.env` > 默认 7.2）
  - 实测改到 7.5 后新账单即刻按新汇率计算；交易 `metadata.rate` 保留当时汇率以便复核
  - 修复「累计消费」只统计最近 100 条导致的静默漏算
  - 修复金额统计依赖 `metadata` 完整性的问题

### 企业组织层已完成
- [x] 企业组织数据模型（纪要 #4、#6；设计方案 §11 第一阶段）—— P0
      Enterprise / Department / EnterpriseMember / EmployeeInstance /
      EmployeeGrant / AccessRequest（Task 未建，随会话一并后置）
- [x] `DigitalEmployee` 拆分为「市场模板」+「企业实例」（设计方案 §6.4）
- [x] `Subscription` / `ComputeAccount` 主体由 user 改为 enterprise
- [x] 部门树 + 成员管理（P1-1）· 员工实例生命周期（P1-2）
- [x] 成员↔实例授权（P1-3）—— 4 个接口 + 授权面板；两条路径（直接/部门）合并
- [x] 前端路由组重构（P1-3）—— `(auth)` / `(market)` / `(enterprise)` / `(platform)`
      单应用 + 按账号角色分权；市场无 AuthGate 公开可浏览；根路径跳 /marketplace
- [x] 部门管理、成员管理、我的员工三个页面（P1-3）

### 下一步（P2）
- [ ] **人才市场主线** ← 下一步
      员工目录（搜索/筛选）· 员工详情（capabilities 展示）· 订阅入口（需登录）
- [ ] 实例详情页 —— 查看/修改配置、停用、升级（接口已全通，页面未做）
- [ ] 跨部门调用申请/审批（`AccessRequest` 表已建，接口未做）
- [ ] 算力用量页面空架子（决策：前端能看到即可）
- [ ] 审计日志（纪要 #7）—— 现有 `ToolExecution` 可作基础
- [ ] 统一员工调用协议草案（纪要 #5；设计方案 §8.1）
      现有 `CapabilityAdapter.execute()` 可作起点，需补启动/暂停/终止/查询状态

### ⏸️ 已暂停
- [ ] ⏸️ **Agent 编排**（多员工协同、指挥官自动拆解）— 设计方案 §8.3 亦列为后续
- [ ] ⏸️ **会话/聊天**（SSE 流式对话）— 本期不做，代码保留

### 适配器方向（保留，MVP 需 1-2 种形态）
- [ ] `capability.service.execute()` 支持 4 类能力
      （`capability.service.ts:220-229` 只 `include: { agentConfig: true }`；
      `rpa_configs`/`skill_configs`/`ai_app_configs` 有数据但从未被读取）
- [ ] SkillAdapter（`skill_configs` 已有 `template`/`modelId`/`temperature`/`maxTokens`；
      模板替换 `{{input}}` → 调 sub2api，不需 function calling）
- [ ] Coze usage 接入计费（Coze **已返回** token 数据，adapter 未读取 → 漏收）
- [ ] OpenCode adapter 状态判断修复（4 行，当前会把成功执行误判超时）
      **不要按 `docs/对接/` 的契约重写** —— 该文档与真实服务不符
- [ ] OpenCode Skills Service 部署 + 鉴权（服务端目前无任何 API 认证）
- [ ] RPA 适配器（需影刀 YINGDAO 账号）· AI_APP 适配器（`IFRAME` 前端嵌入）

### 与方向无关，随时可做
- [ ] 补齐新模型价格表（上游 63 个，`MODEL_PRICING` 仅 7 个）
- [ ] 单元测试补充（订阅系统）
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
   —— 相关：`web/` dev server 非正常退出会遗留 `fork-ts-checker` worker 进程
   （每个挂 `--max-old-space-size=2048`），排查 tsc OOM 时清掉了 22 个
9. **AI SDK v7 泛型是 tsc 内存的雷区**（2026-07-28 已修，记录避免复犯）
   `tool()` + `generateText` + Zod `inputSchema` 三者组合会触发 TS 递归类型
   展开，单文件即可 OOM。新增 AI SDK 调用点时：tools 用 `ToolSet` 标注 +
   提到变量（勿内联）+ `inputSchema` 用 `jsonSchema()` 而非 `z.object()`。
   `tool()` 运行时是恒等函数，去掉无副作用。
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
- ✅ **2026-07-27**: 汇率可配置 + 累计消费统计修正（会议行动项 #1）
- ⏸️ **2026-07-27**: **产品方向调整** —— 会话/Agent 编排暂停，适配器保留并重新定位；
  收敛到「企业级硅基员工人才市场 + 组织中控」
- ✅ **2026-07-28**: P0 企业组织基座（6 张新表 + 多租户隔离）
- ✅ **2026-07-28**: P1-1 部门树 + 成员管理（94 单测 + 21 E2E）
- ✅ **2026-07-28**: P1-2 员工实例管理（22 单测 + 12 E2E）
- ✅ **2026-07-28**: tsc OOM 根因修复（全量编译 OOM → 2.2 秒）
- ✅ **2026-07-28**: P1-3 员工授权（131 单测 + 11 E2E）+ 前端路由组重构 + 三个管理页面（next build 20 页）
- 📅 **下一步**: P2 人才市场主线（员工目录/详情/订阅入口）

更多里程碑详情见 [milestones/](./milestones/)

---

## 快速链接

- [需求与架构规格书](../architecture/硅基人才平台-需求与架构规格书-v2.md)
- [前端设计文档](../architecture/前端设计文档-v1.md)
- [AI 集成实施计划](../plans/AI-Integration-Implementation-Plan.md)
- [E2E 测试指南](../test/guides/E2E-TEST-GUIDE.md)
- [API 文档](http://localhost:3001/api/docs) (本地开发)
