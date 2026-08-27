# 任务中心持久化 API 契约

- 日期：2026-08-27
- 这是**前后端并行开发的唯一契约**。后端（codex）按此实现，前端（Claude）按此对接。
- 任何偏离都必须先改本文档，不能只改一侧代码。

## 0. 背景与现状

任务中心目前**完全没有持久化**：

- 后端只有 `POST /task-plans/preview`（`backend/src/modules/task-planning/task-planning.controller.ts:15`），
  它把目标交给模型、返回一份 `TaskPlan`，**不落库**。
- 前端把计划和模板塞进 `localStorage`（`sep-task-plans` / `sep-task-templates`，
  `web/src/app/(enterprise)/tasks/page.tsx:19`）。
- Prisma schema 里 `model Task` 数量为 **0**。

后果：换浏览器 / 无痕 / 换设备 / 清缓存 → 任务记录全部丢失；执行中关掉标签页 → 步骤永久卡在
`running`；画布拖动过的节点位置刷新即丢。

本次要补的就是这一层。

## 1. 职责边界

| 侧 | 负责人 | 范围 |
|---|---|---|
| 后端 | codex | `backend/` 全部：Prisma 模型 + 迁移 + shared DTO + task 模块 + 单测 |
| 前端 | Claude | `web/` 全部：UI 重构 + 用 TanStack Query 替换 localStorage |

**互不越界**：codex 不改 `web/` 下任何文件；Claude 不改 `backend/` 下任何文件。

## 2. 执行模型（重要）

执行**仍然在前端进行**（浏览器里遍历步骤、逐步调用会话流）。后端只做持久化，不做编排、
不做队列、不做 SSE 推进度。

前端在**步骤边界**写库，而不是流式过程中写库：

```
创建计划        → POST   /api/tasks
点「确认并执行」 → PATCH  /api/tasks/:id  { status: 'running', startedAt }
每一步开始      → PATCH  /api/tasks/:id  { steps }        ← 该步 status=running
每一步结束      → PATCH  /api/tasks/:id  { steps }        ← 该步 completed/failed + output
整个运行结束    → PATCH  /api/tasks/:id  { status, completedAt }
拖动节点后      → PATCH  /api/tasks/:id  { layout }       ← 防抖 800ms
```

流式 token 不写库（太频繁）。因此「关掉标签页后任务继续跑」**不在本次范围内** —— 这是已知
限制，不要试图实现它。

## 3. 数据模型

`steps` 用 **JSON 列**而不是关系表。理由：步骤形状由 LLM 生成、后续会变；步骤里嵌着
employee / capability 的**快照**（历史任务必须显示当时的员工名与技能名，即便员工后来被解雇
或改名），拆成外键反而要处理"快照 vs 引用"的取舍；且读写总是整份计划。

```prisma
enum TASK_RUN_STATUS {
  DRAFT
  AWAITING_CONFIRMATION
  RUNNING
  COMPLETED
  FAILED
  STOPPED
}

model TaskRun {
  id           String          @id @default(cuid())
  objective    String          @db.Text
  summary      String          @db.Text @default("")
  status       TASK_RUN_STATUS @default(AWAITING_CONFIRMATION)
  /// TaskPlanStep[] 快照，形状见 §4.1
  steps        Json
  /// 画布布局 { nodes: Record<stepId,{x,y}>, endpoints: { input?, output? } }
  layout       Json?
  /// { type: 'llm', model: string }
  planner      Json?
  startedAt    DateTime?
  completedAt  DateTime?
  userId       String
  enterpriseId String?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  enterprise Enterprise? @relation(fields: [enterpriseId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([enterpriseId, createdAt])
  @@map("task_runs")
}

model TaskTemplate {
  id           String   @id @default(cuid())
  name         String
  objective    String   @db.Text
  /// TaskPlanStep[] 快照，status 一律 queued、output/error 一律清空
  steps        Json
  layout       Json?
  userId       String
  enterpriseId String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  enterprise Enterprise? @relation(fields: [enterpriseId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@map("task_templates")
}
```

记得在 `User` / `Enterprise` 上补反向关系字段（`taskRuns` / `taskTemplates`），否则
`prisma generate` 会报错。

### 3.1 枚举大小写

Prisma 枚举按项目约定用 `UPPER_SNAKE`，但 **API 出入参一律用小写下划线**
（`awaiting_confirmation`），因为已有的 `POST /task-plans/preview` 返回的就是小写，前端
`TaskRunStatus` 类型也是小写。service 层做双向映射，别把大写泄漏到 HTTP 层。

## 4. 类型

### 4.1 步骤形状（前端既有类型，不要改）

来自 `web/src/features/task/task-orchestration.ts`。后端 Zod schema 必须和它对齐。

> ⚠️ **`CapabilityType` 只能是这四个大写字面值**：`'AGENT' | 'RPA' | 'SKILL' | 'AI_APP'`。
>
> 定义在 `web/src/lib/types.ts:3`，`POST /api/task-plans/preview` 实测返回的就是 `'SKILL'`。
> `backend/src/shared/` 里能力上传那套 DTO 用的是小写 `'agent'|'rpa'|'skill'|'ai-app'`，
> **那是另一个接口的约定，不要照搬到这里** —— 用错会让前端每次 POST 都被 400 拒掉。
> `TaskStepStatus`（`queued|running|completed|failed|skipped`）与 `TaskRunStatus`
> （`draft|awaiting_confirmation|running|completed|failed|stopped`）则确实是小写。


```ts
type TaskStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

interface TaskPlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  intent: string;
  employee: {                      // 快照
    id: string;
    name: string;
    description: string;
    position: string;
    industry: string;
    avatar: string | null;
    capabilities: Array<{ id: string; name: string; description: string; type: CapabilityType }>;
  };
  capability: { id: string; name: string; description: string; type: CapabilityType };
  dependsOn: string[];             // 同一 plan 内的 step id
  rationale: string;
  estimatedSeconds: number;
  status: TaskStepStatus;
  progress: number;                // 0-100
  output?: string;
  error?: string;
  startedAt?: string;              // ISO
  completedAt?: string;            // ISO
  durationMs?: number;
}
```

校验要求：`steps` 数组长度 1–50；每个 `dependsOn` 元素必须是同数组内存在的 `id`（拒绝悬空
依赖）；`output` 单条上限 200_000 字符，整个 `steps` 序列化后上限 2 MB，超限返回 400 而不是
写库失败。

### 4.2 列表项（瘦身）

`GET /api/tasks` **不要返回完整 steps** —— 输出文本会让抽屉列表变得很慢。返回：

```ts
interface TaskRunSummary {
  id: string;
  objective: string;
  status: TaskRunStatus;
  stepCount: number;
  completedStepCount: number;
  employeeNames: string[];      // 去重，最多 4 个，按 step order
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 详情

`GET /api/tasks/:id` 返回 `TaskRun`：上面 summary 的所有字段 + `summary`（文案）+ 完整
`steps` + `layout` + `planner`。

## 5. 端点

全部挂 `@UseGuards(JwtAuthGuard)`，全部要 `@ApiTags` / `@ApiOperation` / `@ApiResponse`。

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| GET | `/api/tasks` | — | `TaskRunSummary[]`，按 `createdAt` 倒序，默认上限 50（`?limit=` 可调，最大 200） |
| POST | `/api/tasks` | `{ objective, summary?, steps, layout?, planner?, status? }` | `TaskRun` |
| GET | `/api/tasks/:id` | — | `TaskRun` |
| PATCH | `/api/tasks/:id` | `{ status?, steps?, layout?, startedAt?, completedAt? }` 全部可选 | `TaskRun` |
| DELETE | `/api/tasks/:id` | — | `{ success: true }` |
| GET | `/api/tasks/templates` | — | `TaskTemplate[]` |
| POST | `/api/tasks/templates` | `{ name, objective, steps, layout? }` | `TaskTemplate` |
| DELETE | `/api/tasks/templates/:id` | — | `{ success: true }` |

### 5.1 两个必须注意的坑

1. **路由顺序**：`/tasks/templates` 必须声明在 `/tasks/:id` **之前**，否则 Nest 会用 `:id`
   把 `templates` 当成 id 吞掉。这是本契约里最容易踩的 bug。
2. **归属校验**：`:id` 系列的每一个路由都要先查出记录、校验 `userId === req.user.id`，
   不匹配抛 `NotFoundException`（不要抛 403 —— 别泄漏"这个 id 存在但不属于你"）。
   不要只按 id 查再直接更新，那是 IDOR。

### 5.2 归属规则

任务与模板都是**创建者私有**：只有创建者能读写自己的记录。企业内其他成员看不到。
`enterpriseId` 冗余存下来只为将来做企业级视图，本次不暴露任何跨用户查询。

## 6. 迁移安全（务必遵守）

开发库里有**演示数据（Boss demo 账号与种子数据），绝对不能重置**。

- 用 `pnpm db:migrate`（即 `prisma migrate dev`）创建迁移，名字 `add_task_runs`。
- **如果 Prisma 提示 drift、或者提议 reset / 要删表 —— 立刻停下并报告，不要接受。**
- 禁止 `prisma migrate reset`、`prisma db push --force-reset`、任何 `DROP TABLE`。
- 本次改动是纯新增（两张新表 + 一个新枚举 + 两个反向关系字段），不应触碰任何既有表。
- 迁移生成后 `pnpm db:generate` 重建 client。

## 7. 验收标准

1. `pnpm build`（backend）通过，`pnpm test` 通过。
2. `task.service.spec.ts` 存在，mock `PrismaService`（不连真库），覆盖：创建、列表瘦身
   映射、PATCH 部分更新、归属校验拒绝他人记录、悬空 `dependsOn` 被拒、枚举大小写映射。
3. Swagger `/api/docs` 能看到 tasks 分组的 8 个端点。
4. 用 curl 实测过 `POST /api/tasks` → `GET /api/tasks` → `PATCH` → `GET /api/tasks/:id` →
   `DELETE` 全链路（拿 boss@acme.local / Demo123456 登录取 token）。
5. `GET /api/tasks/templates` 不会被 `:id` 路由吞掉（实测，不是看代码）。
6. 演示数据完好：`GET /api/contributions/mine` 仍能返回原有能力，用户表行数不变。

## 8. 交付时报告

完成后在最后一条消息里写清：

- 新增/修改的文件清单
- 迁移文件名
- 8 个端点的实测结果（哪些 curl 过了）
- 任何与本契约不一致的地方及原因
- 任何你认为契约本身有问题的地方（**不要擅自改契约，先报告**）

不要执行 `git commit` / `git push` —— 改动留在工作区，由人来提交。

## 9. 完整性要求（本次一步到位，不留二期）

§1–§8 是核心链路，下面这些同样属于本次交付。它们全部是**加法**，不改变 §5 已定的 8 个
端点的请求/响应形状，因此前端可以并行开发。

### 9.1 事件流水（TaskRunEvent）

任务记录只有最终状态是不够的 —— 需要知道每一步什么时候开始、谁在做、失败原因是什么。

```prisma
enum TASK_EVENT_TYPE {
  RUN_CREATED
  RUN_STARTED
  RUN_COMPLETED
  RUN_FAILED
  RUN_STOPPED
  STEP_STARTED
  STEP_COMPLETED
  STEP_FAILED
  STEP_SKIPPED
  STEP_PAUSED
  STEP_RESUMED
  PLAN_EDITED
}

model TaskRunEvent {
  id        String          @id @default(cuid())
  taskRunId String
  type      TASK_EVENT_TYPE
  stepId    String?
  /// 冗余快照，便于列流水时不必回查 steps
  stepTitle String?
  employeeName String?
  message   String?         @db.Text
  createdAt DateTime        @default(now())

  taskRun TaskRun @relation(fields: [taskRunId], references: [id], onDelete: Cascade)

  @@index([taskRunId, createdAt])
  @@map("task_run_events")
}
```

事件由 **service 自动派生**，不要求前端显式上报：`POST /api/tasks` 写 `RUN_CREATED`；
`PATCH` 时对比新旧 `steps` 的 status 差异，为每个发生变化的步骤补对应事件；`status` 变化
补 `RUN_*` 事件。这样前端不用改任何调用方式就能拿到完整流水。

新增端点：

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/tasks/:id/events` | `TaskRunEvent[]`，按 `createdAt` 升序，默认上限 200 |

### 9.2 步骤级更新（避免整份 steps 覆盖）

`PATCH /api/tasks/:id` 传整个 `steps` 数组有两个问题：载荷随输出增长、两个标签页同时开着会
互相覆盖。补一个窄接口：

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| PATCH | `/api/tasks/:id/steps/:stepId` | `{ status?, progress?, output?, error?, startedAt?, completedAt?, durationMs? }` | `TaskRun` |

service 内部读出 `steps`、只改目标 step、写回，并派生对应事件。`stepId` 不在 steps 里返回
404。整份 `PATCH` 保留（改计划结构时用），两者并存。

### 9.3 并发保护

`PATCH`（两个都算）支持可选的乐观锁：请求体可带 `expectedUpdatedAt`（ISO 字符串）。若与库里
的 `updatedAt` 不一致，返回 **409 Conflict**，body 带当前记录，让前端决定怎么合并。不传该字段
时按现在的行为直接覆盖（前端首版可以不传）。

### 9.4 孤儿运行回收

前端执行中关掉标签页 → 记录永远停在 `running`。补一个显式回收接口，由前端在加载列表时对
「`status=running` 且 `updatedAt` 超过 10 分钟」的记录调用：

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/api/tasks/:id/reconcile` | 若 `status=running` 且 `updatedAt` 早于 10 分钟前，置为 `stopped`、把仍是 `running` 的步骤置为 `failed`（error 写「执行中断」）、写 `RUN_STOPPED` 事件；否则原样返回 |

**不要**在服务端起定时任务扫这个 —— 保持无状态，由客户端触发。

### 9.5 企业级视图

企业管理员需要看到本企业内的任务概况。`GET /api/tasks` 支持 `?scope=mine|enterprise`
（默认 `mine`）：

- `scope=enterprise` 仅当调用者在该企业内且角色是 `ENTERPRISE_ADMIN` 才允许，否则 403。
- 返回本企业全部成员的 `TaskRunSummary`，额外带 `owner: { id, name }` 字段。
- `mine` 的返回形状不变（不带 `owner`），前端现有对接不受影响。

### 9.6 列表分页与过滤

`GET /api/tasks` 增加可选查询参数，全部可省略（省略时行为同 §5）：

- `status`：可重复，按运行状态过滤
- `limit`：默认 50，上限 200
- `cursor`：上一页最后一条的 `id`，游标分页（按 `createdAt` 倒序 + `id` 兜稳定序）
- 响应改为 `{ items: TaskRunSummary[], nextCursor: string | null }`

**这一条会改变 `GET /api/tasks` 的响应形状**，是 §9 里唯一的破坏性变更。前端已知悉并按
`{ items, nextCursor }` 对接。其余端点形状不变。

### 9.7 删除语义

`DELETE /api/tasks/:id` 做**硬删除**（连带 events 由 `onDelete: Cascade` 清掉）。正在
`running` 的任务拒绝删除，返回 409 并提示先停止。模板删除无限制。

### 9.8 输入加固

- `objective` 1–4000 字符（和前端 composer 的 4000 上限对齐）
- `name`（模板）1–64 字符，同一用户下重名允许但要 trim
- `layout` 里的坐标必须是有限数字，`-10000 ≤ x,y ≤ 10000`，键必须是当前 steps 里存在的 id
  （`endpoints` 的 `input`/`output` 例外）
- 所有 JSON 列写库前用 Zod parse 过一遍，不要把未校验的 body 直接塞进 `Json` 字段

### 9.9 测试要求（在 §7 之上追加）

`task.service.spec.ts` 还要覆盖：事件派生（steps status 变化 → 对应事件条数与类型）、
步骤级 PATCH 只动目标步骤、`expectedUpdatedAt` 不匹配抛 409、reconcile 的时间边界（9 分钟
不动 / 11 分钟回收）、`scope=enterprise` 非管理员被拒、游标分页翻页正确、悬空 `dependsOn`
与超界 layout 坐标被拒。

### 9.10 明确不做

**执行不搬到后端。** 不要引入队列、worker、SSE 推进度，不要在后端调用 agent runtime。
执行仍由浏览器驱动，后端只负责持久化与派生事件。理由：那需要重做 chat 的流式链路，且会让
正在并行开发的前端全部作废。如果你认为这是错的，在报告里说，但**本次不要动手做**。
