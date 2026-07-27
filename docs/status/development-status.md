# 硅基人才平台 - 开发状态

> 最后更新：2026-07-25（保底计费 + 流式修复）

## 总体进度

- [x] Layer 0: 数据库 Schema + Docker Compose
- [x] Layer 1: 认证 & 基础连接
- [x] Layer 2: 用户模块
- [x] Layer 3: 能力管理
- [x] Layer 4: 数字员工
- [x] Layer 5: 订阅 & 对话系统
- [x] 前端脚手架 & 核心页面
- [x] **AI 集成**（流式对话已通；工具调用受上游限制）
- [x] **计费系统**（已完成并验证，含保底计费）
- [ ] **能力适配器**（4 类仅 AGENT 可执行 ← 当前 P0）
- [ ] 错误处理统一
- [ ] 结构化日志
- [ ] 生产部署

---

## 当前状态

**当前版本**: v0.4.0-alpha
**最新提交**: `feat(model): 上游模型实时同步 + 白名单管理 + 会话级切换 + 系统设置`
**未提交改动**: 保底计费 + 流式错误修复（6 个文件，详见 [progress/2026-07-25-pricing-fallback-and-streaming-fix.md](../progress/2026-07-25-pricing-fallback-and-streaming-fix.md)）
**下一步**: 实现 SkillAdapter（能力适配器 4 类仅 agent 一类可执行，核心卖点阻断）

---

## 模块状态

| 模块 | 状态 | 完成度 | 最后更新 | 备注 |
|------|------|--------|----------|------|
| 用户认证 | ✅ 完成 | 100% | 2026-07-24 | JWT + httpOnly cookie，中文错误提示 |
| 用户管理 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 个人设置 |
| 能力管理 | ✅ 完成 | 95% | 2026-07-24 | CRUD + 审核流程 + status 过滤 |
| **能力适配器** | ⚠️ 部分 | **25%** | 2026-07-25 | 仅 AGENT 类可执行；SKILL/RPA/AI_APP 调用即抛错（`execute()` 只 include agentConfig）|
| 数字员工 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 能力绑定 + 发布管理 |
| 订阅系统 | ✅ 完成 | 100% | 2026-07-23 | 订阅/取消/配置 |
| 对话系统 | ⚠️ 部分 | 85% | 2026-07-25 | SSE 流式对话正常；**带工具的会话必失败**（sub2api 不支持 function calling）|
| 计费系统 | ✅ 完成 | 95% | 2026-07-25 | Token 追踪 + 成本计算 + 保底计费 + 用量统计（已 E2E 验证 + 10 个单元测试）|
| 工具编排 | ⚠️ 部分 | 50% | 2026-07-25 | 工具注册/Zod 转换已实现，但受上游 tools 限制 + 适配器缺口双重阻断 |
| 前端页面 | ✅ 完成 | 95% | 2026-07-25 | 所有核心页面 + 用量统计（修复重复显示问题中）|

---

## 最近变更

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

### 高优先级（P0）
- [ ] **SkillAdapter**（阻断核心卖点，建议最先做）
  - `skill_configs` 已有 `template` / `modelId` / `temperature` / `maxTokens`
  - 实现：模板替换 `{{input}}` → 直接调 sub2api 推理，**不需要 function calling**
  - 因此是当前唯一能绕开 sub2api tools 限制、立刻端到端跑通的能力类型
- [ ] **`capability.service.execute()` 支持 4 类能力**
  - 现状：`capability.service.ts:220-229` 只 `include: { agentConfig: true }`，缺失即抛 `NotFoundException`
  - `rpa_configs` / `skill_configs` / `ai_app_configs` 有数据但从未被读取
  - `AdapterFactory` 仅支持 `OPENCODE` / `COZE`，其余抛 `Unsupported adapter platform`
- [ ] **sub2api function calling 支持**（上游限制，需决策）
  - 带 `tools` 必返 400 `Invalid request`；裸 curl 已对照确认
  - 可选：确认能否开启 tools 透传 / 换中继 / demo 只用无绑定员工
- [ ] 提交保底计费 + 流式修复（6 个文件，建议拆 2 个 commit）

### 中优先级（P1）
- [ ] 补齐新模型价格表（上游 63 个，`MODEL_PRICING` 仅 7 个，其余走保底价偏离实际成本）
- [ ] Coze 能力导入 UI（管理端）
- [ ] 员工创建表单增加模型选择和系统提示词
- [ ] OpenCode Skills Service 适配器（`opencode.adapter.ts` 已有实现，待服务部署验证）
- [ ] RPA 适配器（需映像道 YINGDAO 账号与对接）
- [ ] AI_APP 适配器（`IFRAME` 模式主要是前端嵌入展示）

### 低优先级（P2）
- [ ] 单元测试补充（对话系统、订阅系统）
- [ ] 性能优化（消息虚拟滚动、Redis 缓存）
- [ ] 生产环境配置（环境变量、日志、监控）

---

## 已知问题

### 功能缺口
1. **能力适配器仅 1/4 可用**（P0，核心卖点阻断）
   - 仅 AGENT 类可执行；SKILL / RPA / AI_APP 被调用即抛 `No agent config for capability X`
   - demo 数据 5 条绑定中 4 条为坏的
2. **sub2api 不支持 function calling**（P0，上游限制）
   - 带 `tools` 的请求必返 HTTP 400；所有 agent 类能力无法经模型工具调用触发
3. **能力版本管理** - Schema 有 CapabilityVersion 表，但未实现版本切换逻辑
4. **秘钥加密** - AgentConfig.apiKey 明文存储（生产前需加密）
5. **价格表覆盖率低** - 上游 63 个模型仅 7 个配价，其余按最贵档保底计费（有警示但偏离实际成本）

### 技术债
1. Layer 5 单元测试缺失（18/18 通过的是 Layer 4）
2. 前端 E2E 自动化测试未实现
3. 错误日志未统一（部分模块缺少结构化日志）
4. token 估算公式 `length / 4` 对中文低估 5–10 倍（仅在带工具会话生效）
5. `web/tsconfig.tsbuildinfo` 是构建产物却被 git 追踪，应移出并加 `.gitignore`
6. 测试数据 `e2e-notools` 员工 + 订阅待清理（为绕开 tools 限制临时创建）
7. `DEFAULT_MODEL_ID = "deepseek-v4-flash"` 与 demo 员工 `modelId` 需确认在当前上游列表中有效

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
- 📅 **下一步**: SkillAdapter + `execute()` 支持 4 类能力（核心卖点）
- 📅 **待决策**: sub2api function calling 支持方案
- 📅 **之后**: 错误处理统一 + 结构化日志 → Beta 版本发布

更多里程碑详情见 [milestones/](./milestones/)

---

## 快速链接

- [需求与架构规格书](../architecture/硅基人才平台-需求与架构规格书-v2.md)
- [前端设计文档](../architecture/前端设计文档-v1.md)
- [AI 集成实施计划](../plans/AI-Integration-Implementation-Plan.md)
- [E2E 测试指南](../test/guides/E2E-TEST-GUIDE.md)
- [API 文档](http://localhost:3001/api/docs) (本地开发)
