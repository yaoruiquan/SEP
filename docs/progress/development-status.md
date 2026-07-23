# 开发进度状态表

> 最后更新：2026-07-23 20:52 (Layer 4 完成)

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
| httpOnly Cookie 支持 | ⏭️ 跳过 | 前端开发时再加；目前只有 Bearer Token |
| /auth/refresh 接口 | ⏭️ 跳过 | 同上，前端开发时补 |

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
| Capability CRUD（上传/审核/浏览） | ⏭️ 跳过 | 有意跳过，先跑通核心链路 |
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

## Layer 5 — 对话（Conversation）

| 内容 | 状态 | 备注 |
|------|------|------|
| 创建会话 | ❌ 未做 | |
| 发送消息（流式 SSE） | ❌ 未做 | |
| 消息历史 | ❌ 未做 | |
| 消息持久化（DB） | ❌ 未做 | |

---

## 前端（web/）

| 内容 | 状态 | 备注 |
|------|------|------|
| Next.js 脚手架 | ❌ 未做 | 等后端 L4 完成后统一搭 |
| 技术选型 | ✅ 已定 | Shadcn/ui + TanStack Query + Zustand |
| 三个路由组 (user)(admin)(contributor) | ❌ 未做 | |

---

## 工程质量

| 内容 | 状态 | 备注 |
|------|------|------|
| TypeScript 编译 | ✅ 通过 | |
| 安全扫描（Codex） | ✅ 通过 | 0 严重 / 0 高危 |
| 代码质量检查（Codex） | ✅ 通过 | 0 错误 / 0 警告 |
| 单元测试 | 🔶 部分 | Layer 4 完整（18 个测试），其他层暂无 |
| E2E 测试 | ❌ 未做 | |
