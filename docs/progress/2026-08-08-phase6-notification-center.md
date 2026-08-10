# 2026-08-08 进度报告

**日期**: 2026-08-08
**状态**: Phase 6 ✅ 完成；Phase 4 CI 故障 🔍 已定位，修复待确认

---

## ✅ Phase 6 — 通知中心（已完成）

### 1. 数据库 Schema

新增 `Notification` 模型（`notifications` 表）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | cuid | 主键 |
| `userId` | String | 接收方 |
| `enterpriseId` | String? | 归属企业（可选） |
| `category` | Enum | `SYSTEM / USAGE_ALERT / SECURITY / APPROVAL` |
| `severity` | Enum | `INFO / WARNING / ERROR / CRITICAL` |
| `title` | String | 标题 |
| `content` | String | 正文 |
| `isRead` | Boolean | 已读状态，默认 `false` |
| `metadata` | Json? | 扩展数据 |
| `readAt` | DateTime? | 读取时间 |
| `expiresAt` | DateTime? | 过期时间 |
| `createdAt` | DateTime | 创建时间 |

### 2. 后端

**`NotificationsModule`**（`backend/src/modules/notifications/`）：

- `NotificationsService`
  - `getNotifications` — 分页查询，支持 `category`/`isRead`/`severity` 过滤
  - `getUnreadCount` — 返回未读数
  - `markAsRead` / `markAllAsRead` — 标记已读（含越权防护）
  - `deleteNotification` / `clearRead` — 删除操作
  - `getPreferences` / `updatePreferences` — 偏好设置（UserProfile JSONB）
  - `notifyAdmins` — 内部方法，向企业所有 ADMIN 发送通知（供其他 Service 调用）

- `NotificationsController`（`GET/PATCH/DELETE /notifications/*`）：全路由 JWT 保护

### 3. 前端

| 文件 | 内容 |
|------|------|
| `web/src/features/notifications/use-notifications.ts` | 8 个 hook：`useNotifications`（`refetchInterval: 30_000`）、`useUnreadCount`、`useMarkAsRead`、`useMarkAllAsRead`、`useDeleteNotification`、`useClearRead`、`useNotificationPreferences`、`useUpdateNotificationPreferences` |
| `web/src/components/notification-bell.tsx` | 顶栏铃铛：未读徽章（上限 `99+`）、5 类分 Tab 下拉、点外关闭、WebSocket 实时刷新 |
| `web/src/app/(enterprise)/notifications/page.tsx` | 通知列表页：全量列表 + 5 类过滤 Tab |
| `web/src/app/(enterprise)/settings/profile/page.tsx` | 通知偏好卡片：5 个 Switch（`systemEnabled`/`usageAlertEnabled`/`securityEnabled`/`approvalEnabled`/`emailEnabled`） |

### 4. 验证结果

- `backend` `nest build` 编译通过（0 errors）
- `web` `tsc --noEmit` 通过

---

## 🔍 Phase 4 CI 部署失败 — 根因分析

### 故障表现

GitHub Actions run `feat(enterprise): Phase 4 企业设置完整实现`：
- `Detect changes` ✅ → `Deploy backend` ❌（2m 52s）→ `Deploy web` ⊘ 跳过

### 根本原因

`Deploy backend` 在**服务器上执行 Docker 构建**时，`Dockerfile:26`（`nest build`）报 19 个 TypeScript 错误，退出码 1。

```
webpack 5.97.1 compiled with 19 errors in 38289 ms
```

**原因**：4 个 Phase 4 的 Prisma model 从未写入 `backend/prisma/schema.prisma`（migration SQL 的注释本身承认了这一点）：

```sql
-- These tables were applied directly to the database;
-- this file records the schema for history.
```

`Dockerfile:23` 执行 `prisma generate` 读到不完整的 schema，生成的 client 缺少 4 个 model，`nest build` 随即报错。

### 19 个错误明细

| 错误类型 | 缺失内容 | 数量 |
|---------|---------|------|
| `TS2339: Property 'customRole' does not exist on PrismaService` | `CustomRole` model 未加入 schema | 7 |
| `TS2339: Property 'enterpriseSetting' does not exist on PrismaService` | `EnterpriseSetting` model 未加入 schema | 2 |
| `TS2339: Property 'enterpriseApiKey' does not exist on PrismaService` | `EnterpriseApiKey` model 未加入 schema | 4 |
| `TS2339: Property 'apiCallLog' does not exist on PrismaService` | `ApiCallLog` model 未加入 schema | 2 |
| `TS2353/TS2339: customRoleId` 相关 | `EnterpriseMember.customRoleId` 字段缺失 | 4 |
| **合计** | | **19** |

所有错误集中在 `enterprise-settings.service.ts`。

### 本地为何不报错

本地 `node_modules/.prisma` 是之前 model 还在 schema 时生成的过期客户端，掩盖了 drift；CI 从干净 checkout 重新生成，问题暴露。

### 修复方案（待确认后执行）

将以下内容补入 `schema.prisma`（`EnterpriseModelConfig` 之后）：

```prisma
model EnterpriseSetting {
  id                  String    @id @default(cuid())
  enterpriseId        String    @unique
  enterprise          Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  // webhook / sso / branding / security / localization ...
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@map("enterprise_settings")
}

model CustomRole {
  id           String              @id @default(cuid())
  enterpriseId String
  enterprise   Enterprise          @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  name         String
  permissions  String[]
  members      EnterpriseMember[]
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  @@map("custom_roles")
}

model EnterpriseApiKey {
  id           String       @id @default(cuid())
  enterpriseId String
  enterprise   Enterprise   @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  name         String
  keyPrefix    String
  keyHash      String
  scopes       String[]
  lastUsedAt   DateTime?
  expiresAt    DateTime?
  revokedAt    DateTime?
  createdBy    String
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  logs         ApiCallLog[]
  @@map("enterprise_api_keys")
}

model ApiCallLog {
  id           String           @id @default(cuid())
  enterpriseId String
  enterprise   Enterprise       @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  apiKeyId     String?
  apiKey       EnterpriseApiKey? @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  method       String
  path         String
  statusCode   Int
  durationMs   Int
  ip           String?
  createdAt    DateTime         @default(now())
  @@map("api_call_logs")
}
```

以及在 `EnterpriseMember` 中补：

```prisma
customRoleId  String?
customRole    CustomRole? @relation(fields: [customRoleId], references: [id], onDelete: SetNull)
```

不需要新 migration（表已存在），执行 `pnpm db:generate` 重新生成 client 后 `nest build` 即可通过。

### 附带风险（修复 backend 后）

`Deploy web` 目前会因**缺失页面模块**失败：
- `/my-employees/[id]` — 未实现
- `/settings/integrations` — Phase 8 占位，`next build` 会报 `PageNotFoundError`

需要提前确认处理策略（stub 页面 or 暂时从侧边栏移除入口）。

---

## ⚠️ 遗留问题

| 问题 | 影响 | 建议 |
|------|------|------|
| `schema.prisma` 缺 4 个 Phase 4 model | CI `Deploy backend` 持续失败 | **优先修复** |
| `settings/organization/page.tsx` 第 29/35 行 TS 错误（`enterprise` 字段不在 `UserProfile`） | `next build` 有警告 | 下次迭代修复 |
| `enterprise-settings.service.ts` 未接入 `NotificationsService`（API key 创建/撤销时发安全通知） | 通知中心无 API key 事件 | Phase 6 后续补接 |
| 平台模型元数据缺失（`vendor`/`category`/`contextLength` 全为 NULL） | 白名单价格/上下文长度显示降级 | 待模型同步任务 |
