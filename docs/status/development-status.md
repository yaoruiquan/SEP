# 开发进度状态表

> 最后更新：2026-07-23（方向 B — 后端补洞）

## 图例

| 标记 | 含义 |
|------|------|
| ✅ 完整 | 功能完整，已测试 |
| 🔶 部分 | 核心逻辑完成，有已知缺口 |
| ⏭️ 跳过 | 有意跳过，后续再做 |
| ❌ 未做 | 尚未开始 |

---

## Layer 0 — 基础设施

| 内容 | 状态 | 备注 |
|------|------|------|
| pnpm monorepo（backend + web） | ✅ 完整 | |
| Docker Compose（PostgreSQL + Redis） | ✅ 完整 | |
| Prisma schema（14 个实体） | ✅ 完整 | |
| 初始数据库迁移 | ✅ 完整 | |
| .env.example / .gitignore | ✅ 完整 | |

---

## Layer 1 — 认证 & 外部连接

| 内容 | 状态 | 备注 |
|------|------|------|
| 注册 / 登录（JWT + bcrypt） | ✅ 完整 | |
| JwtAuthGuard + JwtStrategy | ✅ 完整 | |
| sub2api 基础连通（basic-completion） | ✅ 完整 | |
| sub2api 工具调用测试（tool-calling） | ✅ 完整 | |
| sub2api 多步工具测试（multi-step） | ✅ 完整 | |
| httpOnly Cookie 支持 | ✅ 完整 | login/register 设置 httpOnly refresh_token cookie；1h access + 7d refresh |
| /auth/refresh 接口 | ✅ 完整 | GET /auth/refresh，从 cookie 读 refresh token，返回新 access token |
| /auth/me 接口 | ✅ 完整 | GET /auth/me，返回当前用户完整信息（含 avatar/createdAt） |
| /auth/logout | ✅ 完整 | POST /auth/logout，清除 refresh_token cookie |

---

## Layer 2 — 用户模块

| 内容 | 状态 | 备注 |
|------|------|------|
| GET /users/me | ✅ 完整 | |
| PATCH /users/me（name / avatar） | ✅ 完整 | |
| PATCH /users/me/password | ✅ 完整 | |
| 算力余额查询 | ⏭️ 跳过 | 对接算力平台时再做 |
| 管理员用户列表 / 改角色 | ⏭️ 跳过 | RolesGuard 已建（Layer 4），此功能暂不做 |
| 个人简介（bio 字段） | ⏭️ 跳过 | 需 schema migration，暂不加 |

---

## Layer 3 — 能力（Capability）

| 内容 | 状态 | 备注 |
|------|------|------|
| 统一适配器接口（execute） | ✅ 完整 | |
| OpenCode 适配器 | 🔶 部分 | 主流程完整；未做真实联调（OPENCODE_API_BASE_URL 为空） |
| Coze 适配器 | 🔶 部分 | SSE 解析逻辑完整；未持有真实 Bot ID 做端对端测试 |
| Dify 适配器 | ❌ 未做 | 接口已知，照 Coze 模式仿写即可 |
| N8N 适配器 | ❌ 未做 | Webhook 模式，最简单 |
| AdapterFactory | ✅ 完整 | |
| CapabilityService.execute() | ✅ 完整 | |
| Capability CRUD（上传/审核/浏览） | ✅ 完整 | POST/GET/PATCH/DELETE /capabilities；贡献者上传、Admin 审核(approve/reject)、GET 过滤浏览 |
| AgentConfig.apiKey 加密存储 | ⏭️ 跳过 | 目前明文存 DB；生产前需加密 |

---

## Layer 4 — 数字员工（Digital Employee）

| 内容 | 状态 | 备注 |
|------|------|------|
| 数字员工 CRUD | ✅ 完整 | POST/GET/PATCH/DELETE /digital-employees，管理员专用（@Roles(ADMIN)） |
| 能力绑定（bind / unbind） | ✅ 完整 | POST/DELETE /digital-employees/:id/capabilities，仅绑定 APPROVED 能力 |
| DigitalEmployeeRunner（Agent 执行） | ✅ 完整 | 加载员工 + 绑定能力 → 构建 AI SDK tools → generateText |
| RolesGuard + @Roles() decorator | ✅ 完整 | 基于 UserRole 的权限控制 |
| 单元测试（18 用例） | ✅ 完整 | digital-employee.service.spec.ts 全部通过 |

---

## Layer 5.5 — 订阅（Subscription）

| 内容 | 状态 | 备注 |
|------|------|------|
| 订阅员工 | ✅ 完整 | POST /subscriptions，检查员工为 PUBLISHED；重激活 PAUSED/EXPIRED 订阅 |
| 订阅列表 | ✅ 完整 | GET /subscriptions，仅返回 ACTIVE 订阅 |
| 订阅详情 | ✅ 完整 | GET /subscriptions/:id |
| 更新用户配置 | ✅ 完整 | PATCH /subscriptions/:id/config（店铺账号等个性化配置） |
| 取消订阅 | ✅ 完整 | DELETE /subscriptions/:id，状态改为 EXPIRED，保留记录 |
| 对话前置检查 | ✅ 完整 | ConversationService.create() 调用 assertActiveSubscription()，无有效订阅则 403 |

---



| 内容 | 状态 | 备注 |
|------|------|------|
| Redis 集成（ioredis） | ✅ 完整 | RedisModule（@Global），RedisService 生命周期管理 |
| 会话分布式锁 | ✅ 完整 | SessionLockService，Redis SET NX EX + Lua CAS 释放，防并发，60s TTL |
| 创建会话 | ✅ 完整 | POST /conversations，传 employeeId |
| 会话列表 / 详情 | ✅ 完整 | GET /conversations，GET /conversations/:id（含消息历史） |
| 重命名 / 删除会话 | ✅ 完整 | PATCH /conversations/:id（title），DELETE /conversations/:id（级联删消息） |
| 发送消息（流式 SSE） | ✅ 完整 | POST /conversations/:id/messages，Server-Sent Events 实时返回 |
| 手动工具循环 | ✅ 完整 | AI SDK v7 streamText + 工具无 execute → 手动调 CapabilityService.execute() |
| 消息历史加载 | ✅ 完整 | 最近 20 条，DB Message → AI SDK ModelMessage 转换 |
| 消息持久化 | ✅ 完整 | USER / ASSISTANT / TOOL 三种角色，toolCalls 字段存工具调用，JSON 存储 |
| 工具执行记录 | ✅ 完整 | ToolExecution 表，记录 input/output/duration/status |
| 自动标题生成 | ✅ 完整 | 首条消息前 20 字，仅 title=null 时生成，支持手动重命名后不覆盖 |
| SSE 事件协议 | ✅ 完整 | reasoning_delta / text_delta / tool_start / tool_end / done / error |
| AI SDK v7 兼容 | ✅ 完整 | instructions（非 system）、chunk.text（非 textDelta）、chunk.input（非 args）、reasoning-start/end（非 reasoning） |
| TypeScript 编译 | ✅ 通过 | 所有类型错误已修复 |
| 单元测试 | ⏭️ 跳过 | Layer 4 测试全通过（18/18），L5 集成测试待前端开发时补 |

---

## 前端（web/）

| 内容 | 状态 | 备注 |
|------|------|------|
| 前端设计文档 | ✅ 完成 | `docs/architecture/前端设计文档-v1.md`（方案 B 白底商务风，主色 #eb3f00） |
| Next.js 脚手架 | ❌ 未做 | 下一步：Next 15 + Tailwind + Shadcn init |
| 技术选型 | ✅ 已定 | Shadcn/ui + TanStack Query + Zustand |
| 视觉风格 | ✅ 已定 | 方案 B 白底商务风；主色取自 Logo `#eb3f00` |
| 用户仪表盘/看板 | 📋 已设计 | 登录落地页；指标卡 + 我的员工 + 最近会话 |
| 路由组 (user)(admin) | ❌ 未做 | 本期做这两个 |
| 路由组 (contributor) | ⏭️ 延后 | 本期跳过；后续折叠进用户端"我的能力"板块 |

**后端接口缺口（前端所需，待补）**：`GET /users/me/stats`（仪表盘本月消息）、`GET /admin/stats`（Admin 看板）、`GET /admin/users`（用户管理列表）。详见前端设计文档 §9。

---

## 工程质量

| 内容 | 状态 | 备注 |
|------|------|------|
| TypeScript 编译 | ✅ 通过 | |
| 安全扫描（Codex） | ✅ 通过 | 0 严重 / 0 高危 |
| 代码质量检查（Codex） | ✅ 通过 | 0 错误 / 0 警告 |
| 单元测试 | 🔶 部分 | Layer 4 完整（18 个测试），其他层暂无 |
| E2E 测试 | ❌ 未做 | |
