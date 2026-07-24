# 硅基人才平台 - 开发状态

> 最后更新：2026-07-24

## 总体进度

- [x] Layer 0: 数据库 Schema + Docker Compose
- [x] Layer 1: 认证 & 基础连接
- [x] Layer 2: 用户模块
- [x] Layer 3: 能力管理
- [x] Layer 4: 数字员工
- [x] Layer 5: 订阅 & 对话系统
- [x] 前端脚手架 & 核心页面
- [ ] **AI 集成**（当前进行中）
- [ ] 生产部署

---

## 当前状态

**当前版本**: v0.3.0-alpha  
**最新提交**: `chore: update environment configuration for AI integration`  
**下一步**: 实施 AI 集成（ModelService + CapabilityToolBuilder + Coze Adapter）

---

## 模块状态

| 模块 | 状态 | 完成度 | 最后更新 | 备注 |
|------|------|--------|----------|------|
| 用户认证 | ✅ 完成 | 100% | 2026-07-24 | JWT + httpOnly cookie，中文错误提示 |
| 用户管理 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 个人设置 |
| 能力管理 | ✅ 完成 | 95% | 2026-07-24 | CRUD + 审核流程 + status 过滤 |
| 数字员工 | ✅ 完成 | 100% | 2026-07-23 | CRUD + 能力绑定 + 发布管理 |
| 订阅系统 | ✅ 完成 | 100% | 2026-07-23 | 订阅/取消/配置 |
| 对话系统 | 🚧 进行中 | 40% | 2026-07-24 | 前端 UI + SSE 框架完成，AI 集成开发中 |
| 工具编排 | ❌ 未开始 | 0% | - | 依赖 AI 集成完成 |
| 前端页面 | ✅ 完成 | 95% | 2026-07-24 | 核心页面完成，移动端响应式已修复 |

---

## 最近变更

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
- [ ] **AI 集成核心服务**
  - [ ] ModelService - sub2api + Vercel AI SDK 封装
  - [ ] CapabilityToolBuilder - 能力转工具定义
  - [ ] CozeAgentAdapter - Coze 部署应用调用
  - [ ] ConversationService - streamMessage 实现

### 中优先级（P1）
- [ ] Coze 能力导入 UI（管理端）
- [ ] 员工创建表单增加模型选择和系统提示词
- [ ] OpenCode Skills Service 适配器（依赖服务部署）
- [ ] RPA / AI_APP 适配器（需求待明确）

### 低优先级（P2）
- [ ] 单元测试补充（对话系统、订阅系统）
- [ ] 性能优化（消息虚拟滚动、Redis 缓存）
- [ ] 生产环境配置（环境变量、日志、监控）

---

## 已知问题

### 功能缺口
1. **对话响应延迟** - AI 集成未完成，当前为 Mock 数据
2. **费用追踪 / 计费**（决策：先记录，暂不实现）
   - `includeUsage: true` 已修复，sub2api 现可返回 `usage`（input/output/total tokens）
   - **待做**：自维护「模型 → 单价」价格表 + 按 token 计费落库（`ComputeAccount` / `ComputeTransaction` 已在 schema 但未接线）
   - 调研见 `docs/research/sub2api用量追踪与计费对接调研.md`
3. **能力版本管理** - Schema 有 CapabilityVersion 表，但未实现版本切换逻辑
4. **秘钥加密** - AgentConfig.apiKey 明文存储（生产前需加密）

### 技术债
1. Layer 5 单元测试缺失（18/18 通过的是 Layer 4）
2. 前端 E2E 自动化测试未实现
3. 错误日志未统一（部分模块缺少结构化日志）

---

## 里程碑

- ✅ **2026-07-22**: Layer 0 完成（数据库 + Docker）
- ✅ **2026-07-23**: Layer 1-4 完成（后端核心 API）
- ✅ **2026-07-23**: Layer 5 完成（订阅 + 对话系统）
- ✅ **2026-07-23**: 前端脚手架 + 核心页面
- ✅ **2026-07-24**: E2E 测试问题修复
- 🚧 **2026-07-24**: AI 集成开发中
- 📅 **预计 2026-07-26**: AI 集成完成（可端到端对话）
- 📅 **预计 2026-07-28**: Beta 版本发布

更多里程碑详情见 [milestones/](./milestones/)

---

## 快速链接

- [需求与架构规格书](../architecture/硅基人才平台-需求与架构规格书-v2.md)
- [前端设计文档](../architecture/前端设计文档-v1.md)
- [AI 集成实施计划](../plans/AI-Integration-Implementation-Plan.md)
- [E2E 测试指南](../test/guides/E2E-TEST-GUIDE.md)
- [API 文档](http://localhost:3001/api/docs) (本地开发)
