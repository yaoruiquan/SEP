# 开发文档：订阅申请 + 算力配额 + 对象存储

> 编写日期：2026-08-13  
> 范围：  
> - **P0**: 订阅申请工作流（新增需求）  
> - **P2**: 算力配额系统（`phase-next-development-plan.md` 3.5）  
> - **P0**: 对象存储（`phase-next-development-plan.md` 3.1）  
> 不含：`@员工/@技能`（另一分支在做）、健康检查端点（暂缓）

---

## 零、订阅申请工作流（P0 新增需求）

### 0.1 需求背景

**现状**：企业订阅硅基员工后，只有被管理员直接授权的成员才能使用（`EmployeeGrant` 表）。

**新需求**：普通员工发现需要某个硅基员工时，可主动发起订阅申请，管理员审批通过后系统自动创建订阅并授权。

### 0.2 与现有 `AccessRequest` 的区别

| 维度 | `AccessRequest`（现有） | `SubscriptionRequest`（新增） |
|------|------------------------|------------------------------|
| **触发场景** | 企业**已订阅**，员工申请使用授权 | 企业**未订阅**，员工申请让企业订阅 |
| **审批后果** | 创建 `EmployeeGrant`（授权） | 创建 `Subscription` + `EmployeeGrant` |
| **关联对象** | `EmployeeInstance`（实例） | `DigitalEmployee`（模板） |
| **费用影响** | 无，企业已付费 | 有，新增订阅成本 |

**结论**：需要新建 `SubscriptionRequest` 表，两套流程并行。

### 0.3 数据模型

```prisma
/// 订阅申请。普通员工申请订阅硅基员工，管理员审批通过后自动创建订阅并授权。
model SubscriptionRequest {
  id String @id @default(cuid())

  enterpriseId String
  enterprise   Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)

  /// 申请人（企业成员）。成员被移出企业后置为 NULL。
  requesterId String?
  requester   EnterpriseMember? @relation("SubscriptionRequestRequester", fields: [requesterId], references: [id], onDelete: SetNull)

  /// 申请人身份快照（成员被移除后回填）
  requesterEmail String?
  requesterName  String?

  /// 申请订阅的硅基员工模板
  employeeId String
  employee   DigitalEmployee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  /// 申请理由 / 使用场景说明
  reason String? @db.Text
  
  /// 期望订阅时长（天），null = 永久
  requestedDays Int?

  status RequestStatus @default(PENDING)

  /// 审批人（企业管理员或平台管理员）
  reviewerId String?
  reviewer   User?     @relation("SubscriptionRequestReviewer", fields: [reviewerId], references: [id], onDelete: SetNull)
  reviewNote String?   @db.Text
  reviewedAt DateTime?

  /// 审批通过后创建的订阅 ID（用于追溯）
  subscriptionId String?
  subscription   Subscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([enterpriseId])
  @@index([requesterId])
  @@index([employeeId])
  @@index([status])
  @@map("subscription_requests")
}

// 关联表更新：
model Enterprise {
  subscriptionRequests SubscriptionRequest[]
}
model EnterpriseMember {
  subscriptionRequests SubscriptionRequest[] @relation("SubscriptionRequestRequester")
}
model DigitalEmployee {
  subscriptionRequests SubscriptionRequest[]
}
model User {
  reviewedSubscriptionRequests SubscriptionRequest[] @relation("SubscriptionRequestReviewer")
}
model Subscription {
  fromRequests SubscriptionRequest[]
}
```

### 0.4 业务流程

#### 申请流程（普通员工）
1. 员工浏览硅基员工市场，点击「申请订阅」
2. 填写使用场景说明（必填）和期望订阅时长
3. 提交前检查：
   - 企业是否已订阅 → 已订阅则引导去「申请授权」
   - 是否有未处理的同员工申请 → 有则提示勿重复提交
4. 提交成功 → 通知企业管理员

#### 审批流程（管理员）
1. 管理员收到通知，进入「订阅申请管理」
2. 查看申请详情（申请人、员工信息、理由、期望时长）
3. 批准：
   - 调整订阅时长（可选）
   - 系统自动执行（事务）：
     - 创建 `Subscription`（若未订阅）
     - 创建 `EmployeeInstance`（若订阅是新建的）
     - 创建 `EmployeeGrant`（授权申请人）
     - 更新申请状态为 APPROVED，记录 subscriptionId
   - 通知申请人
4. 驳回：填写理由，通知申请人

#### 撤回流程（申请人）
- PENDING 状态下可撤回 → 状态变 CANCELED → 通知管理员

### 0.5 接口设计

**申请端（企业成员）**：
- `POST /subscription-requests` — 创建申请（带重复检查）
- `GET /subscription-requests/my` — 查询我的申请
- `PATCH /subscription-requests/:id/cancel` — 撤回申请

**审批端（企业管理员）**：
- `GET /subscription-requests?enterpriseId=&status=` — 查询待审批
- `PATCH /subscription-requests/:id/approve` — 批准（Body: reviewNote, subscriptionDays）
- `PATCH /subscription-requests/:id/reject` — 驳回（Body: reviewNote）

**核心逻辑**（批准申请伪代码）：
```typescript
async approveRequest(requestId, dto, reviewerId) {
  const request = await findRequestOrThrow(requestId);
  
  // 1. 检查企业是否已订阅
  let subscription = await findActiveSubscription(
    request.enterpriseId, 
    request.employeeId
  );
  
  // 2. 若未订阅，创建订阅
  if (!subscription) {
    subscription = await createSubscription({
      enterpriseId: request.enterpriseId,
      employeeId: request.employeeId,
      endDate: dto.subscriptionDays ? addDays(now, dto.subscriptionDays) : null,
    });
  }
  
  // 3. 创建实例（若订阅是新建的）
  let instance = await findOrCreateInstance(subscription.id);
  
  // 4. 授权申请人
  const grant = await createGrant({
    memberId: request.requesterId,
    instanceId: instance.id,
    expiresAt: subscription.endDate,
  });
  
  // 5. 更新申请状态
  await updateRequest(requestId, {
    status: 'APPROVED',
    reviewerId,
    reviewNote: dto.reviewNote,
    subscriptionId: subscription.id,
  });
  
  // 6. 通知申请人
  await sendNotification(request.requester.userId, '订阅申请已通过');
  
  return { request, subscription, grant };
}
```

### 0.6 前端交互

#### 员工市场页（智能路由）
```tsx
{subscription ? (
  hasGrant ? (
    <Button disabled>已授权使用</Button>
  ) : (
    <Button onClick={requestAccess}>申请授权</Button>  // AccessRequest 流程
  )
) : (
  hasPendingRequest ? (
    <Button disabled>订阅申请审批中</Button>
  ) : (
    <Button onClick={openRequestModal}>申请订阅</Button>  // SubscriptionRequest 流程
  )
)}
```

#### 申请订阅弹窗
- 使用场景说明（必填）
- 期望订阅时长（下拉选择：永久/30/90/180/365 天）

#### 待审批列表（管理端）
- 表格展示：申请人、员工、理由、期望时长、申请时间
- 操作：批准 / 驳回按钮

#### 审批弹窗
- 显示申请详情
- 调整订阅时长（可编辑）
- 填写审批意见
- 提示：批准后将创建订阅并授权（若企业未订阅）

### 0.7 通知机制

| 事件 | 接收人 | 渠道 | 内容 |
|------|--------|------|------|
| 提交申请 | 企业管理员 | 站内信 + 邮件 | `{申请人} 申请订阅「{员工}」，请审批` |
| 批准 | 申请人 | 站内信 + 邮件 | `订阅「{员工}」已通过，现在可使用` |
| 驳回 | 申请人 | 站内信 | `订阅「{员工}」未通过，理由：{xxx}` |
| 撤回 | 管理员 | 站内信 | `{申请人} 撤回了订阅申请` |

### 0.8 实施计划

| 阶段 | 任务 | 预估 |
|------|------|------|
| **Phase 1: 数据层** | | |
| 1.1 | Prisma Schema（SubscriptionRequest + 关联） | 1h |
| 1.2 | 迁移：`pnpm db:migrate --name add-subscription-request` | 15min |
| **Phase 2: 后端接口** | | |
| 2.1 | 创建 subscription-request 模块 | 30min |
| 2.2 | 申请端接口（创建、查询、撤回） | 2h |
| 2.3 | 审批端接口（查询、批准、驳回） | 3h |
| 2.4 | 集成通知服务 | 1h |
| 2.5 | 单元测试 | 2h |
| 2.6 | E2E 测试 | 1h |
| **Phase 3: 前端实现** | | |
| 3.1 | 员工市场页按钮逻辑 | 1h |
| 3.2 | 申请订阅弹窗 | 1h |
| 3.3 | 我的申请列表页 | 2h |
| 3.4 | 待审批列表页（管理端） | 2h |
| 3.5 | 审批弹窗 | 2h |
| 3.6 | 通知展示 | 30min |
| **Phase 4: 联调测试** | | |
| 4.1 | 端到端联调 | 2h |
| 4.2 | 边界情况测试 | 1h |

**总计**：约 **3 人天**（后端 1.5 天 + 前端 1.5 天）

### 0.9 关键防护

| 风险 | 缓解措施 |
|------|---------|
| 与 `AccessRequest` 混淆 | 前端根据订阅状态智能显示按钮 |
| 审批通过但创建订阅失败 | 用事务包裹整个审批逻辑 |
| 重复提交申请 | 提交前检查 PENDING 申请 + 后端强制校验 |
| 通知发送失败 | 记日志但不阻塞主流程 |

---

## 一、先修正计划文档的两处误判

写这份文档时逐项核实了代码，`phase-next-development-plan.md` 有两处与实际不符，
后续排期应以本节为准：

| 计划文档的说法 | 实际情况 |
|---|---|
| 「对象存储未集成」（列为技术债） | **抽象层已完整实现**：driver 接口 + 本地 driver + OSS driver + 按环境变量回退的门面，共 513 行含测试。剩余工作远小于计划预估 |
| P0 对话中心整片未勾选 | 后端 7 个端点、SSE 流式、算力扣费、ToolExecution 落库、前端 Markdown/代码块渲染、多模态输入、会话管理**均已完成** |

核实方式：读 `backend/src/modules/upload/storage/*`、
`backend/src/modules/conversation/*`，并实测后端 373 测试通过 + 启动探针通过。

---

## 一、对象存储（P0 阻塞问题修复）

### 1.1 现状：抽象层已经建好，不要重做

```
backend/src/modules/upload/storage/
├── storage.types.ts          StorageDriver 接口 + PutObjectInput/StoredObject
├── storage.service.ts        门面：按配置选驱动，对外只暴露 put/get/delete/getSignedUrl
├── local-storage.driver.ts   本地磁盘驱动（+ 152 行测试）
└── oss-storage.driver.ts     阿里云 OSS 驱动
```

设计上已经处理好的点，直接沿用：

- **驱动选择靠环境变量**。`readOssConfig()` 检查 `OSS_REGION` / `OSS_ACCESS_KEY_ID` /
  `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` 四件套，缺任意一个返回 `null`，
  `StorageService` 据此回退本地磁盘。本地开发和演示无需云凭据即可跑通完整链路，
  生产只改环境变量 —— 这个取舍是对的，保留。
- **对象私有读 + 签名 URL**。OSS driver 写入时带 `x-oss-object-acl: private`，
  前端拿到的是 1 小时有效期的签名链接。聊天记录被转发出去，链接过期即失效。
- **中文文件名不乱码**。`Content-Disposition` 用 RFC 5987 的 `filename*=UTF-8''` 编码。
- **存储键按企业/用户分目录**：`{enterpriseId|personal}/{userId}/{ts}_{nonce}_{safeName}`。
  随机段防同毫秒同名覆盖，前缀便于后续按企业统计或清理。
- **先校验后落盘**。`upload.controller.ts` 用 `memoryStorage` 而非 `diskStorage`，
  文件先过魔数校验再决定是否写入，脏文件不落地。

### 1.2 阻塞问题：`ali-oss` 是幽灵依赖（P0，必须先修）

**现象**：`oss-storage.driver.ts:3` 顶层 `import OSS from 'ali-oss'`，本地能跑，
但 `ali-oss` 在 `backend/package.json`、根 `package.json`、`web/package.json`
三处均未声明，在 `pnpm-lock.yaml` 中出现 **0 次**。

它今天能解析，只因为 `backend/node_modules/ali-oss` 有一个指向 pnpm store 的软链
（store 里甚至有 6.21.0 和 6.23.0 两个版本），属于某次临时安装的残留。

**后果**：`Dockerfile:10` 用 `pnpm install --frozen-lockfile`，锁文件里没有的包不会装。
而这条 import 链是**无条件**的：

```
UploadModule → providers: [StorageService]
             → storage.service.ts:5  import { OssStorageDriver }
             → oss-storage.driver.ts:3  import OSS from 'ali-oss'   ← MODULE_NOT_FOUND
```

即**与是否配置 OSS 无关，容器启动就会崩**。本地之所以没暴露，全靠那个残留软链。

**修法**（二选一，推荐 A）：

- **A. 补进依赖并锁定**：`pnpm add ali-oss@6.23.0 --filter backend`，提交更新后的
  `pnpm-lock.yaml`。同时补 `@types/ali-oss` 到 devDependencies（当前靠包内类型，
  版本漂移时会炸 tsc）。
- **B. 改成惰性加载**：把 `import` 改成 `readOssConfig()` 返回非 null 时才
  `await import('ali-oss')`，让未配 OSS 的部署完全不需要这个包。代价是驱动构造要变异步。

选 A 的理由：生产终究要用 OSS，惰性加载只是把问题推后，且异步构造会污染 driver 接口。

**验证方式**（这个坑本地测不出来，必须在干净环境验）：

```bash
# 在干净目录模拟 CI 安装，确认 ali-oss 真的被装上
pnpm install --frozen-lockfile --filter backend...
node -e "require.resolve('ali-oss')"
# 或直接 docker build 后跑启动探针
```

### 1.3 剩余工作

| 项 | 说明 | 预估 |
|---|---|---|
| 修幽灵依赖 | 见 1.2，含锁文件与类型声明 | 0.5h |
| 干净环境验证 | `--frozen-lockfile` 安装 + 容器内启动探针 | 0.5h |
| OSS driver 单测 | 本地 driver 有 152 行测试，OSS driver **一行没有**。mock `ali-oss` 客户端，覆盖 put/get/delete/签名 URL 与 ACL/Content-Disposition 头 | 2h |
| 历史附件重签名 | 签名 URL 1 小时过期，重新进入旧会话时需重签。`UploadModule` 已导出 `StorageService` 供会话流服务使用，需确认这条路径真的走通并补测试 | 1h |
| 生产环境变量与 bucket | 建 bucket、配私有读、填四件套；建议同时配跨域与生命周期规则 | 运维协作 |

**不需要做的**：驱动抽象、本地回退、私有读设计、键设计 —— 都已完成。

---

## 二、算力配额系统（P2 优化项）

### 2.1 现状：后扣费已实现，但无配额限制

**已实现的计费链路**（`conversation-stream.service.ts:820-880`）：

```typescript
// 对话结束后扣费
try {
  const account = await this.prisma.computeAccount.upsert({
    where: { enterpriseId: ctx.enterpriseId },
    create: { enterpriseId: ctx.enterpriseId, balance: 0 },
    update: {},
  });
  
  await this.prisma.computeTransaction.create({
    data: {
      accountId: account.id,
      type: "CONSUME",
      amount: -costCNY,  // 负数 = 消费
      sessionId,
      description: `${modelId} 对话消费`,
    },
  });
  
  await this.prisma.computeAccount.update({
    where: { id: account.id },
    data: { balance: { decrement: costCNY } },  // ❌ 无余额检查
  });
} catch (err) {
  this.logger.error(`Failed to record usage`, err);  // ❌ 失败不阻塞对话
}
```

**问题清单**：

| 问题 | 影响 | 优先级 |
|------|------|--------|
| **无前置余额检查** | 账户可透支到负无穷，扣费形同虚设 | P0 |
| **扣费失败不阻塞** | 计费异常时对话照常进行，吃白食 | P0 |
| **缺归属字段** | `ComputeTransaction` 无 `memberId`/`instanceId`，无法追溯是哪个配额实例在消费 | P1 |
| **配额实例未落库** | `phase-next-development-plan.md` 提到的「企业购买配额包」概念在 Prisma schema 里不存在 | P0 |

### 2.2 配额模型设计

#### 2.2.1 实体关系

```
Enterprise (企业)
  ↓ 1:N
ComputeQuota (配额实例)  ← 购买记录，每次购买一个实例
  ├─ type: FREE | STANDARD | PREMIUM | CUSTOM
  ├─ totalTokens: 配额总量（token 数）
  ├─ usedTokens: 已消费（后扣累加）
  ├─ expiresAt: 过期时间
  ├─ status: ACTIVE | EXPIRED | EXHAUSTED
  └─ priority: 优先级（扣费时先扣低优先级的）
  
  ↓ 1:N
ComputeTransaction (消费记录)
  ├─ quotaId: 关联到哪个配额实例  ← 新增字段
  ├─ type: RECHARGE（充值）| CONSUME（消费）
  ├─ amount: 金额（CNY）
  ├─ tokens: token 数量  ← 新增字段
  └─ sessionId / toolExecutionId: 溯源
```

**与现有 `ComputeAccount` 的关系**：
- `ComputeAccount.balance`（金额维度）**保留**，用于财务对账
- `ComputeQuota.remainingTokens`（token 维度）**新增**，用于配额管控
- 扣费时**同时更新两者**：`balance -= costCNY`, `usedTokens += inputTokens + outputTokens`

#### 2.2.2 Prisma Schema 新增

```prisma
model ComputeQuota {
  id            String   @id @default(cuid())
  enterpriseId  String
  enterprise    Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  
  type          String   // FREE | STANDARD | PREMIUM | CUSTOM
  totalTokens   Int      // 配额总量
  usedTokens    Int      @default(0)
  
  expiresAt     DateTime?
  status        String   @default("ACTIVE")  // ACTIVE | EXPIRED | EXHAUSTED
  priority      Int      @default(0)  // 扣费优先级，数字越小越先扣
  
  transactions  ComputeTransaction[]
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  @@map("compute_quotas")
  @@index([enterpriseId, status])
}

model ComputeTransaction {
  // ... 现有字段保留 ...
  
  quotaId       String?  // 关联到配额实例（老数据可为 null）
  quota         ComputeQuota? @relation(fields: [quotaId], references: [id], onDelete: SetNull)
  
  tokens        Int?     // 本次消费的 token 数（老数据可为 null）
  
  @@index([quotaId])
}
```

### 2.3 配额管控逻辑

#### 2.3.1 前置检查（对话开始前）

```typescript
// conversation-stream.service.ts 的 streamConversation() 入口
async checkQuotaAvailable(enterpriseId: string): Promise<void> {
  const quotas = await this.prisma.computeQuota.findMany({
    where: {
      enterpriseId,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { priority: 'asc' },
  });
  
  const totalRemaining = quotas.reduce(
    (sum, q) => sum + (q.totalTokens - q.usedTokens),
    0
  );
  
  if (totalRemaining <= 0) {
    throw new ForbiddenException('算力配额已用尽，请联系管理员充值');
  }
  
  // 预估检查：假设本次对话最多消费 10k tokens
  if (totalRemaining < 10_000) {
    this.logger.warn(`企业 ${enterpriseId} 配额即将耗尽，剩余 ${totalRemaining} tokens`);
  }
}
```

#### 2.3.2 后扣费（对话结束后）

```typescript
// 原 recordUsage 改造
async recordUsage(ctx, usage) {
  const tokens = usage.promptTokens + usage.completionTokens;
  
  // 1. 按优先级找可用配额
  const quotas = await this.prisma.computeQuota.findMany({
    where: {
      enterpriseId: ctx.enterpriseId,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { priority: 'asc' },
  });
  
  let remainingTokens = tokens;
  const updates: Array<{quotaId: string, tokens: number, amount: number}> = [];
  
  // 2. 逐个配额扣除（优先级低的先扣）
  for (const quota of quotas) {
    if (remainingTokens <= 0) break;
    
    const available = quota.totalTokens - quota.usedTokens;
    if (available <= 0) continue;
    
    const toConsume = Math.min(remainingTokens, available);
    const costCNY = (toConsume / tokens) * totalCostCNY;  // 按比例分摊金额
    
    updates.push({ quotaId: quota.id, tokens: toConsume, amount: costCNY });
    remainingTokens -= toConsume;
  }
  
  if (remainingTokens > 0) {
    // 配额不足但对话已经跑完了 → 记录超额消费，人工介入
    this.logger.error(`企业 ${ctx.enterpriseId} 配额不足 ${remainingTokens} tokens，对话已完成但未扣足`);
  }
  
  // 3. 事务提交（全成功或全失败）
  await this.prisma.$transaction([
    // 更新各配额实例
    ...updates.map(u => this.prisma.computeQuota.update({
      where: { id: u.quotaId },
      data: {
        usedTokens: { increment: u.tokens },
        status: u.tokens >= quota.totalTokens - quota.usedTokens ? 'EXHAUSTED' : 'ACTIVE',
      },
    })),
    
    // 记录消费明细
    ...updates.map(u => this.prisma.computeTransaction.create({
      data: {
        accountId: account.id,
        quotaId: u.quotaId,
        type: 'CONSUME',
        amount: -u.amount,
        tokens: u.tokens,
        sessionId,
        description: `${modelId} 对话消费`,
        metadata: { inputTokens, outputTokens, costUSD, rate },
      },
    })),
    
    // 更新账户余额（金额维度）
    this.prisma.computeAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: totalCostCNY } },
    }),
  ]);
}
```

### 2.4 配额管理接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `POST /compute-quotas` | 运营端 | 为企业分配配额包 |
| `GET /compute-quotas?enterpriseId=` | 运营端 | 查询企业所有配额实例 |
| `GET /compute-quotas/my` | 企业端 | 查询自己的配额使用情况 |
| `GET /compute-quotas/:id/transactions` | 企业端 | 查询配额消费明细 |
| `PATCH /compute-quotas/:id/status` | 运营端 | 手动启用/禁用配额 |

**重点接口实现**：

```typescript
// POST /compute-quotas 运营端分配配额
@Post()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_ADMIN')
async createQuota(
  @Body() dto: CreateComputeQuotaDto,  // { enterpriseId, type, totalTokens, expiresAt?, priority? }
) {
  return this.quotaService.create(dto);
}

// GET /compute-quotas/my 企业端查询自己配额
@Get('my')
@UseGuards(JwtAuthGuard)
async getMyQuotas(@Request() req) {
  const { enterpriseId } = req.user;
  const quotas = await this.quotaService.findByEnterprise(enterpriseId);
  
  const totalAllocated = quotas.reduce((sum, q) => sum + q.totalTokens, 0);
  const totalUsed = quotas.reduce((sum, q) => sum + q.usedTokens, 0);
  const totalRemaining = totalAllocated - totalUsed;
  
  return {
    quotas,
    summary: {
      totalAllocated,
      totalUsed,
      totalRemaining,
      usagePercent: (totalUsed / totalAllocated * 100).toFixed(2),
    },
  };
}
```

### 2.5 定时任务：配额过期检查

```typescript
// compute-quota.service.ts
@Cron('0 0 * * *')  // 每天 0 点
async expireQuotas() {
  const expired = await this.prisma.computeQuota.updateMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  });
  
  this.logger.log(`已过期 ${expired.count} 个配额实例`);
}
```

**依赖**：`@nestjs/schedule` 已在 `backend/package.json` 中安装（见 `nest-di-boot-check.md`）。

## 三、实施计划

### 3.1 优先级重排（调整后）

```
P0（核心功能，优先）                P1（功能完整）              P2（优化增强）
  │                                    │                          │
  ├─ 订阅申请工作流                    ├─ OSS driver 测试         ├─ 配额告警通知
  │  └─ 数据层 + 接口 + 前端           │  （2h）                 │  （1h）
  │     （3 人天）                     │                          │
  │                                    ├─ 历史附件重签名           ├─ 配额续期接口
  ├─ 修 ali-oss 依赖                   │  （1h）                 │  （1h）
  │  （0.5h）                         │                          │
  │                                    └─ 生产 OSS 部署           ├─ 配额转让
  └─ 干净环境验证                        （运维协作）              │  （2h）
     （0.5h）                                                     │
                                                                  └─ 导出账单 CSV
P2（非紧急）                                                         （1h）
  │
  ├─ Prisma 新增 ComputeQuota
  │  （0.5h + migrate）
  │
  ├─ 前置配额检查
  │  （1h）
  │
  ├─ 后扣费改造
  │  （2h）
  │
  ├─ 配额管理接口
  │  （3h）
  │
  └─ 配额过期定时任务
     （0.5h）
```

**优先级调整理由**：
- **订阅申请**：新增业务需求，直接影响用户体验和企业使用流程，提升到 P0
- **ali-oss 依赖**：阻塞生产部署，保持 P0
- **算力配额**：后扣费已实现，配额管控是优化项，降级到 P2

### 3.2 分阶段执行（调整后）

#### Phase 1: 订阅申请工作流（3 人天，P0）

**数据层**（1h）
1. 编辑 `backend/prisma/schema.prisma`，加入 `SubscriptionRequest` 模型
2. 更新关联表的反向关联（Enterprise、EnterpriseMember、DigitalEmployee、User、Subscription）
3. 执行迁移：`pnpm db:migrate --name add-subscription-request`
4. 生成 Prisma Client：`pnpm db:generate`

**后端接口**（1.5 天）
5. 创建模块：
   ```bash
   cd backend/src/modules
   nest g module subscription-request
   nest g service subscription-request
   nest g controller subscription-request
   ```
6. 实现申请端接口（2h）：
   - `POST /subscription-requests` — 创建申请（含重复检查）
   - `GET /subscription-requests/my` — 查询我的申请
   - `PATCH /subscription-requests/:id/cancel` — 撤回申请
7. 实现审批端接口（3h）：
   - `GET /subscription-requests` — 查询待审批（分页 + 筛选）
   - `PATCH /subscription-requests/:id/approve` — 批准申请（事务：创建订阅 + 实例 + 授权）
   - `PATCH /subscription-requests/:id/reject` — 驳回申请
8. 集成通知服务（1h）：
   - 提交申请 → 通知管理员
   - 批准/驳回 → 通知申请人
   - 撤回申请 → 通知管理员
9. 单元测试（2h）：
   - Service 层测试（mock Prisma）
   - 边界情况：重复申请、已订阅企业、事务回滚
10. E2E 测试（1h）：
    - 完整申请-审批流程
    - 权限检查（普通成员不能审批）

**前端实现**（1.5 天）
11. 员工市场页改造（1h）：
    - 根据订阅状态显示不同按钮（申请订阅 / 申请授权 / 已授权）
    - 集成状态查询逻辑
12. 申请订阅弹窗（1h）：
    - 表单：使用场景说明（必填）+ 期望订阅时长（下拉）
    - 提交前重复检查
13. 我的申请列表页（2h）：
    - 表格展示申请记录
    - 状态筛选（全部 / 待审批 / 已通过 / 已驳回 / 已撤回）
    - 撤回操作
14. 待审批列表页（管理端，2h）：
    - 表格展示所有待审批申请
    - 批准/驳回按钮
15. 审批弹窗（2h）：
    - 显示申请详情（申请人、员工、理由、期望时长）
    - 批准：可调整订阅时长 + 填写审批意见
    - 驳回：必填驳回理由
16. 通知展示（30min）：
    - 复用现有 Notification 组件
    - 新增消息类型处理

**联调测试**（4h）
17. 端到端联调（2h）：
    - 申请 → 审批 → 订阅创建 → 授权发放 → 使用员工
    - 验证事务一致性（批准失败时无脏数据）
18. 边界测试（1h）：
    - 重复申请拦截
    - 已订阅企业的申请引导
    - 撤回后重新申请
    - 审批权限控制
19. 性能测试（1h）：
    - 大量待审批申请的列表渲染
    - 审批操作响应时间

#### Phase 2: 对象存储阻塞问题修复（1 天，P0）

20. **修 `ali-oss` 幽灵依赖**（30min）
   ```bash
   cd backend
   pnpm add ali-oss@6.23.0
   pnpm add -D @types/ali-oss
   git add pnpm-lock.yaml backend/package.json
   git commit -m "fix(upload): add missing ali-oss dependency"
   ```

21. **干净环境验证**（30min）
   ```bash
   # 临时目录模拟 CI
   mkdir /tmp/sep-test && cd /tmp/sep-test
   git clone <repo> .
   pnpm install --frozen-lockfile --filter backend...
   node -e "require.resolve('ali-oss')"
   
   # 或 docker build 验证
   docker build -t sep-backend:test .
   docker run --rm sep-backend:test node -e "require.resolve('ali-oss')"
   ```

22. **OSS driver 单测**（2h）
    - mock `ali-oss` 客户端（`vi.mock('ali-oss')`）
    - 覆盖 put / get / delete / getSignedUrl
    - 验证 `x-oss-object-acl: private` 和 `Content-Disposition` 头

23. **历史附件重签名**（1h）
    - 在会话查询接口里，对消息里的附件 URL 判断是否 OSS 链接
    - 若是且已过期（或接近过期），调用 `storageService.getSignedUrl()` 重签
    - 补测试验证这条路径

24. **生产 OSS 部署**（运维协作）
    - 阿里云建 OSS bucket，设置私有读、跨域、生命周期规则
    - 填环境变量：`OSS_REGION` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET`
    - 容器重启验证

#### Phase 3: 算力配额系统（选做，P2）

25. **Prisma 新增 `ComputeQuota` 模型**（30min）
    - 编辑 `backend/prisma/schema.prisma`，加入 2.2.2 的 Schema
    - `pnpm db:migrate --name add-compute-quota`
    - `pnpm db:generate`

26. **前置配额检查**（1h）
    - 在 `conversation-stream.service.ts` 的 `streamConversation()` 入口加检查
    - 配额不足时抛 `ForbiddenException`

27. **后扣费改造**（2h）
    - 按 2.3.2 的逻辑改写 `recordUsage()`
    - 扣费失败时抛异常，不再 catch-and-log

28. **配额管理接口**（3h）
    ```bash
    cd backend/src/modules
    nest g module compute-quota
    nest g service compute-quota
    nest g controller compute-quota
    ```
    - 实现 2.4 的接口：创建配额、查询配额、配额明细

29. **定时任务：配额过期**（30min）
    - 按 2.5 加 `@Cron` 装饰器
    - 测试：手动创建过期配额，验证状态变更

#### Phase 3: 对象存储扫尾（1 天，P1）

8. **OSS driver 单测**（2h）
   - mock `ali-oss` 客户端（`vi.mock('ali-oss')`）
   - 覆盖 put / get / delete / getSignedUrl
   - 验证 `x-oss-object-acl: private` 和 `Content-Disposition` 头

9. **历史附件重签名**（1h）
   - 在会话查询接口里，对消息里的附件 URL 判断是否 OSS 链接
   - 若是且已过期（或接近过期），调用 `storageService.getSignedUrl()` 重签
   - 补测试验证这条路径

10. **生产部署准备**（运维协作）
    - 阿里云建 OSS bucket，设置私有读、跨域、生命周期规则
    - 填环境变量：`OSS_REGION` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET`
    - 容器重启验证

#### Phase 4: 优化增强（选做，P2）

11. **配额告警**（1h）
    - 剩余量 < 10% 时发邮件 / 站内信通知企业管理员

12. **配额续期 / 转让接口**（3h）
    - 运营端手动延长配额过期时间
    - 企业间转让配额（需审批流）

13. **导出账单 CSV**（1h）
    - `GET /compute-quotas/transactions/export?start=&end=`
    - 生成 CSV 供财务对账

### 3.3 验收标准

| 项 | 标准 | 验证方式 |
|---|------|---------|
| **订阅申请流程** | | |
| 申请提交 | 普通成员可提交申请，重复提交被拦截 | Postman 调 `POST /subscription-requests` 验证 409 响应 |
| 申请查询 | 成员只能看自己的申请，管理员能看企业所有申请 | 查询接口验证权限隔离 |
| 申请撤回 | PENDING 状态可撤回，其他状态不可撤回 | 对已批准申请调撤回接口验证 400 |
| 审批批准 | 事务创建订阅+实例+授权，subscriptionId 正确记录 | 查数据库验证三张表关联完整 |
| 审批驳回 | 状态变 REJECTED，通知申请人 | 查 notifications 表验证消息 |
| 通知发送 | 提交/批准/驳回/撤回均触发通知 | 查 notifications 表验证 4 种场景 |
| 前端按钮逻辑 | 根据订阅状态显示正确按钮 | 手动测试未订阅/已订阅/已授权三种状态 |
| **对象存储修复** | | |
| OSS 依赖修复 | `pnpm install --frozen-lockfile` 后 `require.resolve('ali-oss')` 不报错 | CI 通过 + docker build 成功 |
| OSS driver 测试 | 覆盖率 > 80% | `pnpm test:cov` |
| 历史附件重签名 | 旧会话的 OSS 附件可正常访问 | 打开 1 小时前的会话，验证图片加载 |
| **配额系统（选做）** | | |
| 配额前置检查 | 配额耗尽时对话无法开始，返回 403 | 手动清空配额，调 `/conversations/stream` 验证报错 |
| 配额后扣费 | 对话结束后 `ComputeQuota.usedTokens` 增加，`status` 变 `EXHAUSTED` | 查数据库验证 |
| 扣费失败阻塞 | 配额更新失败时对话崩溃而非静默 | mock Prisma 抛异常，验证 500 而非 200 |
| 配额查询接口 | 企业端能看到自己的配额统计 | Postman 调 `/compute-quotas/my` 验证返回结构 |
| 配额过期 | 定时任务每天跑，过期配额状态变更 | 手动触发 `expireQuotas()`，查数据库验证 |

### 3.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **订阅申请相关** | | |
| 用户混淆两种申请（订阅 vs 授权） | 重复申请或走错流程 | 前端根据订阅状态智能显示按钮，提示文案清晰区分 |
| 审批通过但创建订阅失败 | 申请人收到通知但无法使用 | 用事务包裹整个审批逻辑，失败全回滚 |
| 重复提交申请 | 管理员收到大量重复申请 | 提交前检查 PENDING 申请 + 后端强制校验（唯一索引） |
| 通知发送失败 | 管理员/申请人错过消息 | 通知失败记日志，不阻塞主流程；前端有待处理徽章提醒 |
| 批量申请导致性能问题 | 待审批列表加载慢 | 分页查询 + 索引优化（enterpriseId, status） |
| **对象存储相关** | | |
| 迁移失败导致数据不一致 | P0 | Prisma migrate 自带事务，失败自动回滚 |
| OSS 签名 URL 过期导致旧消息图片 404 | P2 | 前端显示「附件已过期，点击重新加载」按钮；或改成 7 天有效期 |
| **配额系统相关（选做）** | | |
| 配额扣费逻辑复杂易出错 | P1 | 单测覆盖边界情况（多配额、不足、过期混合）；先沙箱企业跑一周 |
| 定时任务与手动扣费竞态 | P2 | `computeQuota` 表的 update 操作用乐观锁（Prisma `@@version` 字段） |

---

## 四、总结

### 4.1 已完成

- 对象存储抽象层（513 行含测试）
- 对话计费链路（后扣费，但无配额管控）
- 认证 / 会话 / 消息等核心功能

### 4.2 待补齐（本文档范围）

| 模块 | 优先级 | 预估工时 | 说明 |
|------|--------|---------|------|
| **订阅申请工作流** | P0 | 3 人天 | 数据层 + 后端接口 + 前端交互 + 通知 + 测试 |
| **OSS 依赖修复** | P0 | 1 天 | 修幽灵依赖 + 验证 + 测试 + 生产部署 |
| **算力配额系统** | P2 | 2 天 | Schema + 前置检查 + 后扣费改造 + 管理接口 + 定时任务 |

**总计**：P0 部分 **4 人天**（订阅申请 3 天 + OSS 1 天），P2 部分 2 天（选做）

### 4.3 关键决策

#### 订阅申请工作流

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 是否复用 `AccessRequest` | **否，新建 `SubscriptionRequest`** | 触发场景、审批后果、关联对象均不同 |
| 审批时长由谁定 | **管理员在审批时填写** | 管理员更了解企业预算和实际需求 |
| 订阅失败如何处理 | **整个审批流程回滚** | 用事务保证一致性 |
| 重复申请如何防止 | **提交前检查 + 后端校验** | 前端友好提示 + 后端强制校验 |
| 前端按钮如何选择 | **根据订阅状态智能路由** | 未订阅→申请订阅，已订阅→申请授权 |

#### 对象存储

| 决策点 | 选择 | 理由 |
|--------|------|------|
| `ali-oss` 依赖如何修 | **补进 package.json 并锁定版本** | 生产终究要用 OSS |
| 签名 URL 过期处理 | **前端重签名按钮（P1）** | 1 小时过期是合理安全策略 |

#### 算力配额（选做）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 配额单位 | **token 数** | 模型价格波动时配额不受影响 |
| 前置检查策略 | **只拦截明显不足（剩余 0）** | 避免预扣复杂退款逻辑 |
| 后扣费策略 | **按优先级消费多个配额** | 支持「赠送包 + 购买包」混合 |
| 扣费失败处理 | **必须抛异常** | 宁可对话崩溃也不能白送算力 |

### 4.4 下一步行动

1. **立即执行**（P0）：
   - 启动订阅申请工作流开发（3 人天）
   - 修复 `ali-oss` 幽灵依赖（30min）

2. **并行进行**（P0）：
   - 前后端订阅申请并行开发
   - OSS driver 测试与历史附件重签名

3. **择机执行**（P2）：
   - 算力配额系统（后扣费已实现，配额管控是优化项）

4. **持续跟进**：
   - 订阅申请上线后收集用户反馈
   - 监控审批通过率和平均审批时长
   - 评估是否需要自动审批规则

