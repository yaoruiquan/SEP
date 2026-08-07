# 企业端功能增强 · 分阶段开发计划

**创建日期**: 2026-08-07
**范围**: 企业端 `(enterprise)` 路由组 + 对应后端模块
**排除项**: ❌ 对话质量监控（满意度评分 / 错误率统计）—— 本轮不做

---

## 总览

| 阶段 | 主题 | 预估周期 | 优先级 |
|------|------|---------|--------|
| **Phase 0** | 部门成员管理 | 1 周 | P0 |
| **Phase 1** | 模型配置中心 | 1.5 周 | P0 |
| **Phase 2** | 知识库测试工具 + 文档处理增强 | 1 周 | P0 |
| **Phase 3** | 成本归因分析 + 用量告警 | 1.5 周 | P0 |
| **Phase 4** | 企业设置拆分 + 权限细化 | 2 周 | P1 |
| **Phase 5** | 对话审计 + 对话模板 | 1 周 | P1 |
| **Phase 6** | 通知中心 | 1 周 | P1 |
| **Phase 7** | 任务中心（定时/批量任务） | 2 周 | P2 |
| **Phase 8** | 审批流自定义 + SSO 集成 | 2 周 | P2 |

**依赖关系**：
```
Phase 0 ──┬──> Phase 3（成本归因按部门归因依赖成员归属关系）
          └──> Phase 4（成员权限细化依赖部门主管角色）
Phase 1 ──┬──> Phase 3（成本归因依赖模型配置的预算字段）
          └──> Phase 2（知识库测试需读取 embedding 模型配置）
Phase 4 ──┬──> Phase 5（对话审计依赖细化权限）
          └──> Phase 8（审批流依赖自定义角色）
Phase 3 ──> Phase 6（用量告警是通知中心的一类消息源）
```

**通用约束**：
- ⚠️ **禁止执行数据库重置**（`prisma migrate reset`）。所有 schema 变更必须是**增量迁移**：新增表、新增可空列、新增枚举值，不删除/重命名既有字段。
- 所有 DTO 用 Zod 定义在 `backend/src/shared/index.ts`，前后端共用。
- 每个新端点必须有 `@ApiTags` / `@ApiOperation` / `@ApiResponse`。
- 敏感字段（apiKey、密钥、token）**永不下发**到前端响应。

---

## Phase 0 · 部门成员管理（P0）

### 目标

让企业管理员和部门主管能在部门管理页中**实际添加、移除成员**，并设置部门主管。当前页面为空壳（只有树形结构展示，无成员操作入口）。

### 后端

**Prisma 增量变更**（仅新增可空列，不动既有字段）：

```prisma
// Department 表新增主管字段
model Department {
  // ... 既有字段保持不变

  leaderId     String?  @map("leader_id")
  leader       User?    @relation("DepartmentLeader", fields: [leaderId], references: [id])

  @@map("departments")
}

// User 表新增反向关系（纯关系字段，无迁移 SQL）
model User {
  // ... 既有字段保持不变

  ledDepartments Department[] @relation("DepartmentLeader")

  @@map("users")
}
```

> ⚠️ `leaderId` 为可空外键，`pnpm db:migrate` 生成的 SQL 只含 `ALTER TABLE departments ADD COLUMN leader_id TEXT`，不影响现有数据。

**新文件**（挂在既有 `department` 模块下，或新建子模块）：

```
backend/src/modules/department/
├── department-member.controller.ts   ← 成员操作 HTTP 层
├── department-member.service.ts      ← 成员操作业务逻辑
```

并在 `department.module.ts` 中注册两个新的 provider / controller。

**端点**（`@ApiTags('Department Members')`）：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/departments/:id/members?page=&limit=&search=` | 列出部门成员，支持搜索/分页 |
| POST | `/departments/:id/members` | 添加成员 `{ userIds: string[] }` |
| DELETE | `/departments/:id/members/:userId` | 移除单个成员（清空 departmentId） |
| POST | `/departments/:id/members/batch-invite` | 批量邀请 `{ emails: string[], roleId?: string }` |
| PUT | `/departments/:id/leader` | 设置/清除部门主管 `{ userId: string \| null }` |

**权限控制**（`DepartmentMemberService.checkPermission()`）：
- **ADMIN**：全部门操作 + 设置主管
- **部门主管**（`ledDepartments` 包含目标部门）：本部门成员增删，不能设置主管
- **其他**：`ForbiddenException`

**附加**：`GET /users?departmentId=null` 查询企业内无部门成员（供添加成员弹窗使用），在既有 `UserController` 增加 `departmentId` 过滤参数。

**Zod DTO**（新增到 `backend/src/shared/index.ts`）：

```typescript
export const AddMembersDtoSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1),
});

export const BatchInviteDtoSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  roleId: z.string().cuid().optional(),
});

export const SetLeaderDtoSchema = z.object({
  userId: z.string().cuid().nullable(),
});

export type AddMembersDto   = z.infer<typeof AddMembersDtoSchema>;
export type BatchInviteDto  = z.infer<typeof BatchInviteDtoSchema>;
export type SetLeaderDto    = z.infer<typeof SetLeaderDtoSchema>;
```

**核心业务逻辑要点**：
- `addMembers`：`prisma.user.updateMany({ where: { id: { in: userIds } }, data: { departmentId } })`
- `removeMember`：`prisma.user.update({ where: { id: userId }, data: { departmentId: null } })`
- `setLeader`：`prisma.department.update({ where: { id: deptId }, data: { leaderId: userId } })`
- `batchInvite`：为每个 email 创建 `pending` 激活状态用户并关联部门（真实邮件发送留待邮件服务集成）

### 前端

**新增路由**：

```
web/src/app/(enterprise)/departments/
└── [id]/
    └── members/
        └── page.tsx      ← 部门成员管理页
```

**新增组件**：

```
web/src/features/department/
├── add-members-dialog.tsx     ← 从无部门用户中多选添加
├── batch-invite-dialog.tsx    ← 输入邮箱批量邀请
└── use-department-members.ts  ← TanStack Query hooks
```

**现有页面改造**（`web/src/app/(enterprise)/departments/page.tsx`）：

在每个部门行的操作区新增「成员管理」按钮，点击跳转至 `/departments/:id/members`：

```tsx
<Button variant="ghost" size="sm" onClick={() => router.push(`/departments/${dept.id}/members`)}>
  <Users className="mr-2 h-4 w-4" />
  成员管理
</Button>
```

**成员管理页功能**：
- 搜索框（实时筛选）+ 「添加成员」/ 「批量邀请」按钮
- 成员列表：头像 / 姓名 / 邮箱 / 角色 / 主管标识（👑 图标）/ 移除按钮
- 主管设置：成员行内「设为主管」操作，当前主管有「取消主管」操作
- 空状态：无成员时展示引导插图 + 添加按钮

**Hook**（`use-department-members.ts`）：

```typescript
// 列表 + 增删 + 设主管
export function useDepartmentMembers(deptId: string, search: string)
export function useAddMembers(deptId: string)
export function useRemoveMember(deptId: string)
export function useSetLeader(deptId: string)
export function useBatchInvite(deptId: string)
```

### 迁移步骤

```bash
# 1. 添加 leaderId 可空列（review SQL，确认只有 ALTER TABLE ADD COLUMN）
pnpm db:migrate

# 2. 重建 Prisma Client
pnpm db:generate

# 3. 重启后端（新 controller/service 需注册进 module）
pnpm dev:backend
```

### 验收标准

- [ ] 部门管理页每个部门有「成员管理」入口
- [ ] 成员管理页可列出当前部门所有成员，支持姓名/邮箱搜索
- [ ] 添加成员弹窗展示企业内无部门的用户，勾选后批量加入
- [ ] 移除成员后该用户 `departmentId` 变为 null，刷新后不再显示
- [ ] 设置主管后该成员在列表中显示主管标识
- [ ] 部门主管登录后可操作本部门成员，无权设置主管
- [ ] 非管理员 / 非主管访问返回 403
- [ ] 迁移 SQL 无 `DROP` / `RENAME`，`pnpm build` 通过

---

## Phase 1 · 模型配置中心（P0）

### 目标
让企业管理员统一配置「会话用什么模型、知识库用什么模型、员工用什么模型」，并设置成本上限。

### 后端

**Prisma 新增模型**（新增表，不动既有表）：

```prisma
model EnterpriseModelConfig {
  id           String @id @default(cuid())
  enterpriseId String @unique

  // ── 会话模型 ──
  defaultChatModel     String   @default("gemini-3.5-flash-high")
  allowedChatModels    String[] @default([])   // 空数组 = 不限制
  allowUserSwitchModel Boolean  @default(true)

  // ── 知识库模型 ──
  embeddingModel String  @default("text-embedding-3-small")
  rerankModel    String?
  embeddingBatchSize Int @default(32)
  embeddingTimeoutMs Int @default(30000)

  // ── 员工模型策略 ──
  // FOLLOW_TEMPLATE：跟随能力模板；ENTERPRISE_OVERRIDE：强制企业默认
  employeeModelPolicy String @default("FOLLOW_TEMPLATE")
  employeeDefaultModel String?

  // ── 成本控制 ──
  monthlyBudgetCNY Decimal? @db.Decimal(12, 2)
  alertThreshold   Float    @default(0.8)   // 0~1
  hardStopOnBudget Boolean  @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)

  @@map("enterprise_model_configs")
}
```

**部门级覆盖**（可选，Phase 1 后半段）：

```prisma
model DepartmentModelPolicy {
  id           String  @id @default(cuid())
  departmentId String  @unique
  defaultChatModel String?
  allowedChatModels String[] @default([])
  monthlyBudgetCNY Decimal? @db.Decimal(12, 2)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  department Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)

  @@map("department_model_policies")
}
```

**新模块** `backend/src/modules/enterprise-model-config/`：
```
enterprise-model-config.module.ts
enterprise-model-config.controller.ts
enterprise-model-config.service.ts
dto/enterprise-model-config.dto.ts
```

**端点**（`@ApiTags('Enterprise Model Config')`）：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/enterprises/:id/model-config` | 读取配置（不存在则返回系统默认） |
| PUT | `/enterprises/:id/model-config` | 全量更新（ENTERPRISE_ADMIN） |
| GET | `/enterprises/:id/model-config/available-models` | 可选模型列表（来自 `PlatformModel` + `MODEL_CATALOG`） |
| PUT | `/departments/:id/model-policy` | 部门级覆盖 |
| GET | `/enterprises/:id/model-config/effective?departmentId=&employeeInstanceId=` | 解析后的最终生效配置 |

**模型解析优先级**（`resolveEffectiveModel()`）：
```
用户会话内手动选择（若 allowUserSwitchModel=true 且在白名单内）
  → 员工实例 config.modelId（若 employeeModelPolicy=FOLLOW_TEMPLATE）
  → 部门 DepartmentModelPolicy.defaultChatModel
  → 企业 EnterpriseModelConfig.defaultChatModel
  → 系统 DEFAULT_MODEL_ID
```

**接入点改造**：
- `conversation-stream.service.ts` — 发起 streamText 前调用 `resolveEffectiveModel()`
- `embedding.service.ts` — 从企业配置读取 `embeddingModel` / `embeddingBatchSize`
- 若 `hardStopOnBudget=true` 且当月已超预算 → 抛 `ForbiddenException('企业本月算力预算已用尽')`

**Zod DTO**（`backend/src/shared/index.ts`）：
`EnterpriseModelConfigSchema`、`UpdateEnterpriseModelConfigDtoSchema`、`DepartmentModelPolicyDtoSchema`、`EffectiveModelConfigSchema`

### 前端

**页面**：`web/src/app/(enterprise)/settings/models/page.tsx`

三个 Tab：

```
┌─ 模型配置 ──────────────────────────────────┐
│ [会话模型] [知识库模型] [员工模型]           │
├──────────────────────────────────────────────┤
│ 默认会话模型   [gemini-3.5-flash-high  ▾]   │
│ 可用模型白名单                               │
│   ☑ gemini-3.5-flash-high   ¥0.5/1M in     │
│   ☑ claude-sonnet-5         ¥21/1M in      │
│   ☐ claude-opus-5           ¥105/1M in     │
│ 允许成员自行切换模型   [ ●—— ] 开启          │
├──────────────────────────────────────────────┤
│ 月度预算  [  5000  ] 元                      │
│ 告警阈值  ──────●───── 80%                   │
│ 超预算硬性阻断  [ ——○ ] 关闭                 │
└──────────────────────────────────────────────┘
```

**组件**：`web/src/features/enterprise-settings/`
- `model-config-form.tsx`
- `model-whitelist-picker.tsx`（展示模型名 + 单价 + 上下文长度）
- `budget-control-card.tsx`
- `use-model-config.ts`（TanStack Query hooks）

**会话侧**：`(enterprise)/chat` 的模型选择器读取白名单；`allowUserSwitchModel=false` 时隐藏选择器并显示锁定图标。

### 验收标准
- [ ] 企业管理员可保存并读取模型配置，刷新后保持
- [ ] 白名单外的模型不出现在会话模型选择器中
- [ ] 关闭「允许成员切换」后，普通成员的会话强制使用默认模型
- [ ] 知识库文档向量化使用配置的 embedding 模型
- [ ] 部门策略覆盖企业策略，`/effective` 返回正确的解析结果
- [ ] 迁移为纯新增表，`prisma migrate dev` 无数据丢失

---

## Phase 2 · 知识库测试工具 + 文档处理增强（P0）

### 目标
让管理员在浏览器里直接验证检索效果，并掌握文档解析状态。

### 后端

**新增端点**（挂在既有 `knowledge` 模块下）：

| Method | Path | 说明 |
|--------|------|------|
| POST | `/knowledge-bases/:id/test-search` | 检索测试，入参 `{ query, topK, scoreThreshold, useRerank }` |
| GET | `/knowledge-bases/:id/documents/status` | 文档处理状态汇总（PENDING/PROCESSING/COMPLETED/FAILED 计数 + 明细） |
| POST | `/documents/:id/reprocess` | 失败重试 / 重新向量化 |
| POST | `/documents/batch-reprocess` | 批量重试（按知识库 + 状态过滤） |
| GET | `/knowledge-bases/:id/analytics` | 检索分析：热门命中分块 TopN、命中率、零命中查询、未被检索的文档 |

**测试检索返回结构**：
```typescript
{
  query: string,
  tookMs: number,
  strategy: 'vector' | 'fulltext-fallback',
  embeddingModel: string,
  results: Array<{
    chunkId: string,
    documentId: string,
    documentName: string,
    content: string,
    score: number,
    chunkIndex: number,
  }>
}
```
> `strategy` 字段用于暴露「Pinecone 未配置时降级为全文检索」这一现状，避免误判检索质量。

**Prisma 新增**（分析用，可空字段 + 新表）：
```prisma
model KnowledgeSearchLog {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  enterpriseId    String
  query           String
  topK            Int
  hitCount        Int
  topScore        Float?
  strategy        String
  isTest          Boolean  @default(false)
  createdAt       DateTime @default(now())

  @@index([knowledgeBaseId, createdAt])
  @@map("knowledge_search_logs")
}
```

`Document` 增补可空列（不破坏既有数据）：
```prisma
  version        Int      @default(1)
  lastError      String?
  processedAt    DateTime?
  embeddingModel String?
```

### 前端

**测试对话框**：`web/src/features/knowledge/knowledge-test-dialog.tsx`

```
┌─ 检索测试 · 产品手册知识库 ──────────────────┐
│ 问题  [ 退货流程是什么？              ] [测试]│
│ topK [5]   相似度阈值 ──●──── 0.65   ☐ 重排  │
├──────────────────────────────────────────────┤
│ ⚡ 12ms · 向量检索 · text-embedding-3-small   │
│                                              │
│ ① 0.912  产品手册.pdf · 分块 #17             │
│    「用户可在订单完成后 7 日内申请退货…」     │
│ ② 0.847  售后FAQ.md · 分块 #3                │
│    「退货需保持商品完好，附带原始包装…」      │
│ ③ 0.681  产品手册.pdf · 分块 #22             │
└──────────────────────────────────────────────┘
```

**文档状态面板**：`web/src/features/knowledge/document-status-panel.tsx`
- 进度条（已完成 / 总数）
- 失败列表 + 错误摘要 + 「重试」「批量重试」按钮
- 轮询间隔 3s（仅在存在 PROCESSING 文档时启用）

**分析页**：`web/src/app/(enterprise)/knowledge/[id]/analytics/page.tsx`
- 热门命中分块 Top 10（柱状图，recharts）
- 命中率趋势（近 30 天折线）
- 零命中查询列表（提示补充文档）
- 从未被检索的文档列表（提示清理）

### 验收标准
- [ ] 输入问题可看到带分数的分块结果，`strategy` 正确标注检索方式
- [ ] 调整 topK / 阈值实时影响结果数量
- [ ] 上传失败的文档能一键重试并恢复为 COMPLETED
- [ ] 批量上传时进度条实时更新
- [ ] 分析页正确展示零命中查询与未使用文档

---

## Phase 3 · 成本归因分析 + 用量告警（P0）

### 目标
把算力消耗拆解到部门 / 员工 / 模型三个维度，并在接近预算时主动告警。

**依赖**：Phase 1（预算字段）

### 后端

**新模块** `backend/src/modules/cost-analytics/`

数据来源：`Message.cost` + `ComputeTransaction` + `ConversationSession`（关联 employeeInstanceId → department）。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/enterprises/:id/cost/summary?from=&to=` | 总览：总花费、环比、预算使用率 |
| GET | `/enterprises/:id/cost/by-department?from=&to=` | 按部门 |
| GET | `/enterprises/:id/cost/by-employee?from=&to=` | 按员工实例 |
| GET | `/enterprises/:id/cost/by-model?from=&to=` | 按模型（含 token 数与单价） |
| GET | `/enterprises/:id/cost/trend?granularity=day\|week\|month` | 趋势 |
| GET | `/enterprises/:id/cost/export?format=csv\|pdf` | 导出 |
| GET | `/enterprises/:id/cost/alerts` | 当前告警列表 |

**聚合表**（避免全表扫描，按天预聚合）：
```prisma
model CostDailyRollup {
  id            String   @id @default(cuid())
  enterpriseId  String
  departmentId  String?
  employeeInstanceId String?
  modelId       String
  date          DateTime @db.Date
  inputTokens   BigInt   @default(0)
  outputTokens  BigInt   @default(0)
  costCNY       Decimal  @db.Decimal(12, 4)
  messageCount  Int      @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([enterpriseId, departmentId, employeeInstanceId, modelId, date])
  @@index([enterpriseId, date])
  @@map("cost_daily_rollups")
}
```

**Rollup 任务**：`@nestjs/schedule` Cron，每小时增量刷新当天数据，每日 00:30 固化前一天。

**告警检测**：Cron 每小时检查 `当月累计 / monthlyBudgetCNY >= alertThreshold` → 写 `Notification`（Phase 6 消费）+ 邮件（若已配置 SMTP）。

**导出**：CSV 用 `fast-csv`；PDF 用 `pdfkit`（服务端渲染表格 + 汇总）。

### 前端

**页面**：`web/src/app/(enterprise)/analytics/cost/page.tsx`

```
┌─ 成本分析 ───────────────  [近30天 ▾] [导出▾]┐
│ 本月花费 ¥3,241.50   预算 ¥5,000   使用 64.8%│
│ ████████████████░░░░░░░░  ⚠ 阈值 80%         │
├────────────────┬─────────────────────────────┤
│ 按部门          │ 按模型                      │
│ 销售部  ¥1,420 │ claude-sonnet-5   ¥2,100    │
│ 客服部  ¥980   │ gemini-3.5-flash  ¥890      │
│ 技术部  ¥841   │ text-embedding-3  ¥251      │
├────────────────┴─────────────────────────────┤
│ 按员工 Top 10（表格：员工 / 部门 / 会话数 /   │
│ token / 花费 / 占比）                         │
├──────────────────────────────────────────────┤
│ 花费趋势（折线图，按天）                      │
└──────────────────────────────────────────────┘
```

**组件**：`web/src/features/cost-analytics/`
- `cost-summary-cards.tsx`
- `cost-by-dimension-chart.tsx`（复用，传 dimension prop）
- `cost-trend-chart.tsx`
- `cost-export-menu.tsx`
- `use-cost-analytics.ts`

### 验收标准
- [ ] 三个维度的金额之和与总览一致
- [ ] 日期范围切换后数据正确刷新
- [ ] CSV / PDF 导出内容与页面一致
- [ ] 超过阈值时页面出现告警条 + 生成一条通知
- [ ] rollup 任务重复执行不产生重复数据（upsert 幂等）

---

## Phase 4 · 企业设置拆分 + 权限细化（P1）

### 目标
把「企业设置」从「个人设置」中独立出来，并把粗粒度角色拆成可配置的细粒度权限。

### 后端

**Prisma 新增**：

```prisma
model EnterpriseSetting {
  id           String @id @default(cuid())
  enterpriseId String @unique

  // 安全策略
  sensitiveWordsEnabled Boolean  @default(false)
  sensitiveWords        String[] @default([])
  ipWhitelist           String[] @default([])
  sessionTimeoutMinutes Int      @default(480)
  forcePasswordRotationDays Int?

  // 集成
  webhookUrl    String?
  webhookSecret String?   // 加密存储，永不下发

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  @@map("enterprise_settings")
}

model EnterpriseRole {
  id           String   @id @default(cuid())
  enterpriseId String
  name         String
  description  String?
  permissions  String[] @default([])   // 见下方权限枚举
  isBuiltin    Boolean  @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([enterpriseId, name])
  @@map("enterprise_roles")
}

model EnterpriseApiKey {
  id           String    @id @default(cuid())
  enterpriseId String
  name         String
  keyPrefix    String              // 明文前缀，用于展示 sk-ent-abc***
  keyHash      String              // bcrypt，永不下发
  scopes       String[]  @default([])
  lastUsedAt   DateTime?
  expiresAt    DateTime?
  revokedAt    DateTime?
  createdBy    String

  createdAt DateTime @default(now())

  @@index([enterpriseId])
  @@map("enterprise_api_keys")
}

model ApiCallLog {
  id           String   @id @default(cuid())
  enterpriseId String
  apiKeyId     String?
  method       String
  path         String
  statusCode   Int
  durationMs   Int
  ip           String?
  createdAt    DateTime @default(now())

  @@index([enterpriseId, createdAt])
  @@map("api_call_logs")
}
```

`EnterpriseMember` 增补可空列：`customRoleId String?`

**权限枚举**（`backend/src/shared/index.ts`）：
```typescript
export const ENTERPRISE_PERMISSIONS = [
  'kb:view', 'kb:edit', 'kb:delete', 'kb:grant',
  'employee:view', 'employee:create', 'employee:grant',
  'conversation:view_own', 'conversation:view_all', 'conversation:export',
  'cost:view', 'cost:export',
  'member:view', 'member:invite', 'member:remove',
  'setting:view', 'setting:edit',
  'quota:allocate',
  'apikey:manage',
  'approval:configure', 'approval:review',
] as const;
```

**守卫**：`PermissionGuard` + `@RequirePermission('kb:edit')` 装饰器，内置角色映射到权限集合（ENTERPRISE_ADMIN = 全部）。

**端点**：

| Method | Path |
|--------|------|
| GET/PUT | `/enterprises/:id/settings` |
| GET/POST/PUT/DELETE | `/enterprises/:id/roles` |
| PUT | `/enterprises/:id/members/:memberId/role` |
| GET/POST | `/enterprises/:id/api-keys`（POST 响应**唯一一次**返回明文 key） |
| DELETE | `/enterprises/:id/api-keys/:keyId`（撤销） |
| GET | `/enterprises/:id/api-logs` |
| PUT | `/knowledge-bases/:id/grants`（读/写授权细化） |

### 前端

**路由重构**：
```
web/src/app/(enterprise)/settings/
├── page.tsx              → 重定向到 /settings/profile
├── profile/page.tsx      个人设置（从原 settings 拆出）
├── organization/page.tsx 企业基本信息
├── models/page.tsx       模型配置（Phase 1）
├── security/page.tsx     安全策略：敏感词库 / IP 白名单 / 会话超时
├── roles/page.tsx        角色与权限矩阵
├── api-keys/page.tsx     API 密钥管理 + 调用日志
├── integrations/page.tsx Webhook（SSO 占位，Phase 8 填充）
└── billing/page.tsx      算力充值 / 账单 / 发票
```

**权限矩阵组件**：`web/src/features/enterprise-settings/permission-matrix.tsx`
（行 = 权限，列 = 角色，复选框网格；内置角色只读）

**API Key 创建**：模态框内一次性展示明文 + 「复制」按钮 + 「关闭后无法再次查看」警示。

### 验收标准
- [ ] 个人设置与企业设置完全分离，各自独立路由
- [ ] 自定义角色创建后，成员绑定该角色，越权访问返回 403
- [ ] API Key 明文仅在创建响应中出现一次，列表接口只返回前缀
- [ ] 敏感词库保存后在 Phase 5 的审计中生效
- [ ] IP 白名单为空时不做限制，非空时拦截非白名单来源

---

## Phase 5 · 对话审计 + 对话模板（P1）

### 目标
满足合规留痕需求，并提升高频场景的输入效率。
❌ **不包含**满意度评分与错误率统计。

### 后端

```prisma
model ConversationAuditLog {
  id           String   @id @default(cuid())
  enterpriseId String
  sessionId    String
  messageId    String?
  userId       String
  type         String   // SENSITIVE_WORD_HIT | EXPORT | MANUAL_REVIEW
  detail       Json?
  createdAt    DateTime @default(now())

  @@index([enterpriseId, createdAt])
  @@index([sessionId])
  @@map("conversation_audit_logs")
}

model ConversationTemplate {
  id           String   @id @default(cuid())
  enterpriseId String
  departmentId String?
  title        String
  content      String
  category     String?
  usageCount   Int      @default(0)
  createdBy    String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([enterpriseId])
  @@map("conversation_templates")
}
```

**敏感词拦截**：在 `conversation-stream.service.ts` 用户消息入库前，用 Aho-Corasick（`node-aho-corasick` 或自实现 Trie）匹配企业敏感词库；命中则写审计日志，按配置决定「仅记录」或「阻断」。

| Method | Path |
|--------|------|
| GET | `/enterprises/:id/audit-logs?type=&from=&to=` |
| GET | `/enterprises/:id/conversations/export?format=csv\|json` |
| GET/POST/PUT/DELETE | `/enterprises/:id/conversation-templates` |
| POST | `/conversation-templates/:id/use`（计数 +1） |

### 前端

- `web/src/app/(enterprise)/conversations/audit/page.tsx` — 审计日志表格，按类型/时间筛选，支持导出
- `web/src/features/chat/template-picker.tsx` — 输入框上方「/」触发模板快选面板
- `web/src/app/(enterprise)/settings/templates/page.tsx` — 模板 CRUD

### 验收标准
- [ ] 命中敏感词的消息在审计日志中可查，含命中词与上下文
- [ ] 会话导出 CSV / JSON 内容完整且包含时间戳与角色
- [ ] 在聊天输入框输入 `/` 可唤起模板面板，选中后填入内容
- [ ] 模板使用次数正确累加

---

## Phase 6 · 通知中心（P1）

### 目标
统一承载系统通知、用量告警、安全告警三类消息。

**依赖**：Phase 3（告警产出）、Phase 4（安全事件产出）

### 后端

复用既有 `Notification` 模型，增补可空列：
```prisma
  category  String?   // SYSTEM | USAGE_ALERT | SECURITY | APPROVAL
  severity  String?   // INFO | WARNING | ERROR
  actionUrl String?
```

**通知生产者**：
- 用量告警 —— Phase 3 Cron（预算 80% / 100%）
- 安全告警 —— 异常登录（新 IP / 新设备）、API Key 创建与撤销、权限变更
- 系统通知 —— 员工模板升级、能力审批结果、知识库处理失败

| Method | Path |
|--------|------|
| GET | `/notifications?category=&unreadOnly=` |
| GET | `/notifications/unread-count` |
| POST | `/notifications/:id/read` |
| POST | `/notifications/read-all` |
| GET/PUT | `/notifications/preferences`（分类订阅开关 + 邮件通知开关） |

### 前端

- 顶栏铃铛：`web/src/features/notifications/notification-bell.tsx`（未读红点，5s 轮询 `unread-count`）
- 下拉面板：分类 Tab（全部 / 告警 / 安全 / 系统）
- 全页：`web/src/app/(enterprise)/notifications/page.tsx`
- 偏好设置并入 `settings/profile`

> 现状 `web/src/hooks/use-realtime.ts` 中 WebSocket 传空 URL 被禁用。本阶段采用**轮询实现**；WebSocket Gateway 留待后续单独立项，不阻塞本阶段。

### 验收标准
- [ ] 预算超阈值后铃铛出现未读红点，点击可跳转成本分析页
- [ ] 标记已读后计数实时下降
- [ ] 关闭某分类订阅后不再收到该类通知
- [ ] 分类筛选正确

---

## Phase 7 · 任务中心（P2）

### 目标
支持定时任务与批量任务，把重复性运营动作自动化。

### 后端

```prisma
model ScheduledTask {
  id           String   @id @default(cuid())
  enterpriseId String
  name         String
  type         String   // PERIODIC_REPORT | KB_SYNC | CONVERSATION_CLEANUP | BATCH_GENERATE
  cronExpr     String
  config       Json
  enabled      Boolean  @default(true)
  lastRunAt    DateTime?
  nextRunAt    DateTime?
  createdBy    String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  runs TaskRun[]
  @@index([enterpriseId])
  @@map("scheduled_tasks")
}

model TaskRun {
  id       String   @id @default(cuid())
  taskId   String
  status   String   // PENDING | RUNNING | SUCCESS | FAILED
  startedAt DateTime?
  finishedAt DateTime?
  result   Json?
  error    String?

  createdAt DateTime @default(now())

  task ScheduledTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@index([taskId, createdAt])
  @@map("task_runs")
}
```

**执行器**：BullMQ（复用既有 Redis 7）+ `@nestjs/schedule` 做 cron 注册。任务类型以策略模式实现 `TaskHandler` 接口，便于扩展。

**内置任务类型**：
- `PERIODIC_REPORT` — 定期生成成本/用量报告并发通知（依赖 Phase 3、6）
- `KB_SYNC` — 定期重新处理指定知识库中失败/过期文档（依赖 Phase 2）
- `CONVERSATION_CLEANUP` — 清理 N 天前的会话（软删除）
- `BATCH_GENERATE` — 批量调用员工生成内容（输入 CSV，输出 CSV）

| Method | Path |
|--------|------|
| GET/POST/PUT/DELETE | `/enterprises/:id/tasks` |
| POST | `/tasks/:id/run-now` |
| POST | `/tasks/:id/toggle` |
| GET | `/tasks/:id/runs` |
| GET | `/task-templates`（预置模板列表） |

### 前端

- `web/src/app/(enterprise)/tasks/page.tsx` — 任务列表（名称/类型/cron 可读化/下次执行/状态/开关）
- `web/src/app/(enterprise)/tasks/[id]/page.tsx` — 执行历史 + 日志 + 结果下载
- `web/src/features/tasks/cron-builder.tsx` — 可视化 cron 编辑器（每天/每周/每月 + 高级手写）
- `web/src/features/tasks/task-template-gallery.tsx`

### 验收标准
- [ ] 创建定时任务后按 cron 正确触发，`nextRunAt` 准确
- [ ] 「立即执行」可手动触发并生成 TaskRun 记录
- [ ] 失败任务记录 error 并可重试
- [ ] 禁用任务后不再触发
- [ ] 批量生成任务产出 CSV 可下载

---

## Phase 8 · 审批流自定义 + SSO 集成（P2）

### 目标
让企业按自身流程配置审批链路，并接入企业微信 / 钉钉单点登录。

**依赖**：Phase 4（自定义角色）

### 后端 · 审批流

```prisma
model ApprovalFlow {
  id           String   @id @default(cuid())
  enterpriseId String
  name         String
  targetType   String   // EMPLOYEE_ACCESS | KB_ACCESS | QUOTA_INCREASE | CAPABILITY_BIND
  enabled      Boolean  @default(true)
  steps        Json     // [{ order, approverType: ROLE|USER|DEPT_MANAGER, approverId?, mode: ANY|ALL }]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([enterpriseId, targetType])
  @@map("approval_flows")
}

model ApprovalInstance {
  id           String   @id @default(cuid())
  flowId       String
  enterpriseId String
  targetType   String
  targetId     String
  requesterId  String
  status       String   @default("PENDING")  // PENDING | APPROVED | REJECTED | CANCELLED
  currentStep  Int      @default(0)
  records      Json     @default("[]")       // [{ step, approverId, action, comment, at }]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([enterpriseId, status])
  @@map("approval_instances")
}
```

既有 `AccessRequest` 保持不变，新增审批流命中时改由 `ApprovalInstance` 驱动状态流转，`AccessRequest` 作为业务载体同步更新——**不删除既有表与字段**。

| Method | Path |
|--------|------|
| GET/POST/PUT/DELETE | `/enterprises/:id/approval-flows` |
| GET | `/approval-instances?status=&role=requester\|approver` |
| POST | `/approval-instances/:id/approve` |
| POST | `/approval-instances/:id/reject` |
| POST | `/approval-instances/:id/cancel` |

### 后端 · SSO

```prisma
model SsoConfig {
  id           String  @id @default(cuid())
  enterpriseId String  @unique
  provider     String  // WECOM | DINGTALK | OIDC
  corpId       String?
  agentId      String?
  clientId     String?
  clientSecret String?   // 加密存储，永不下发
  issuerUrl    String?
  enabled      Boolean @default(false)
  autoCreateUser Boolean @default(true)
  defaultRole  String  @default("MEMBER")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  @@map("sso_configs")
}
```

`User` 增补可空列：`ssoProvider String?`、`ssoSubject String?`（加 `@@unique([ssoProvider, ssoSubject])`）

| Method | Path |
|--------|------|
| GET/PUT | `/enterprises/:id/sso-config` |
| GET | `/auth/sso/:enterpriseSlug/authorize` |
| GET | `/auth/sso/:enterpriseSlug/callback` |

复用既有 JWT 签发逻辑，SSO 回调成功后走同一套 token 下发路径。

### 前端

- `web/src/app/(enterprise)/settings/approvals/page.tsx` — 审批流配置（按目标类型分组，步骤可拖拽排序，复用 `@dnd-kit`）
- `web/src/app/(enterprise)/approvals/page.tsx` — 我的待办 / 我发起的
- `web/src/features/approvals/approval-flow-builder.tsx`
- `settings/integrations/page.tsx` 填充 SSO 配置卡片 + 「测试连接」按钮
- 登录页增加「企业单点登录」入口

### 验收标准
- [ ] 配置两级审批后，请求需两级通过才生效
- [ ] `mode: ANY` 时任一审批人通过即进入下一步
- [ ] 驳回后请求状态为 REJECTED 且通知发起人
- [ ] 未配置审批流的目标类型沿用原有直接授权逻辑（向后兼容）
- [ ] 企业微信扫码登录可创建/绑定用户并签发 JWT
- [ ] `clientSecret` 在任何 GET 响应中都不出现

---

## 里程碑与交付节奏

| 里程碑 | 包含阶段 | 交付物 |
|--------|---------|--------|
| **M0 · 可用** | Phase 0 | 部门成员真实可管理，组织架构落地 |
| **M1 · 可控** | Phase 1 + 2 | 企业能配模型、能验证知识库检索质量 |
| **M2 · 可算** | Phase 3 | 成本可归因到部门/员工、预算可告警 |
| **M3 · 可管** | Phase 4 + 5 + 6 | 权限细化、合规留痕、通知闭环 |
| **M4 · 可自动化** | Phase 7 + 8 | 任务自动化、审批流、SSO |

## 迁移检查清单（每阶段执行）

1. `pnpm db:migrate` 生成增量迁移，人工 review 生成的 SQL —— **确认无 `DROP` / `RENAME`**
2. `pnpm db:generate` 重建 Prisma Client
3. 新模块注册进 `backend/src/app.module.ts`
4. 新 DTO 导出自 `backend/src/shared/index.ts`
5. `pnpm build` 全量构建通过
6. Swagger `/api/docs` 中新端点齐全且有描述
7. 单元测试覆盖 service 层核心分支（mock PrismaService）
8. 进度报告写入 `docs/progress/`
