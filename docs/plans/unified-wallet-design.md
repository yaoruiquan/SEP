# 统一钱包系统设计

## 一、设计目标

1. **统一支付体系**：所有预付款进入同一个钱包
2. **灵活退款**：解雇员工的钱可用于任何消费
3. **清晰账单**：每笔收支都有明确记录
4. **并发安全**：高并发场景下余额准确
5. **审计追踪**：每笔交易可追溯来源和去向

## 二、数据模型

### 2.1 EnterpriseWallet（企业钱包）

```prisma
model EnterpriseWallet {
  id           String   @id @default(cuid())
  enterpriseId String   @unique
  
  // 余额（使用 Decimal 避免浮点精度问题）
  balance      Decimal  @default(0) @db.Decimal(10, 2)
  
  // 冻结金额（退款处理中、订单待支付等）
  frozenAmount Decimal  @default(0) @db.Decimal(10, 2)
  
  // 乐观锁版本号（防止并发余额错乱）
  version      Int      @default(0)
  
  // 累计统计（只增不减，用于展示）
  totalDeposit  Decimal @default(0) @db.Decimal(10, 2)  // 累计充值
  totalConsume  Decimal @default(0) @db.Decimal(10, 2)  // 累计消费
  totalRefund   Decimal @default(0) @db.Decimal(10, 2)  // 累计退款
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  enterprise   Enterprise @relation(fields: [enterpriseId], references: [id])
  transactions WalletTransaction[]
  
  @@map("enterprise_wallets")
}
```

**关键字段说明**：
- `balance`：可用余额 = 充值 - 消费 + 退款
- `frozenAmount`：冻结金额（如：提现审核中、退款处理中）
- `version`：乐观锁，每次更新 +1，防止并发覆盖

---

### 2.2 WalletTransaction（钱包交易记录）

```prisma
model WalletTransaction {
  id          String   @id @default(cuid())
  walletId    String
  
  // 交易类型和金额
  type        WalletTransactionType
  amount      Decimal  @db.Decimal(10, 2)  // 正数=入账，负数=出账
  
  // 交易前后余额快照（审计用）
  balanceBefore Decimal @db.Decimal(10, 2)
  balanceAfter  Decimal @db.Decimal(10, 2)
  
  // 关联业务实体
  relatedType String?  // 'subscription', 'compute', 'payment_order'
  relatedId   String?  // 订阅 ID / 支付订单 ID
  
  // 支付相关
  paymentMethod String?  // 'alipay', 'wechat', 'balance'
  paymentOrderId String? @unique
  
  // 描述和元数据
  description String?   // 人类可读描述："订阅【内容营销专员】"
  metadata    Json?     // 扩展信息
  
  createdAt   DateTime @default(now())
  createdBy   String?  // 操作人 userId（管理员调整时记录）
  
  wallet      EnterpriseWallet @relation(fields: [walletId], references: [id])
  
  @@index([walletId, createdAt(sort: Desc)])
  @@index([relatedType, relatedId])
  @@index([paymentOrderId])
  @@map("wallet_transactions")
}

enum WalletTransactionType {
  DEPOSIT      // 充值（支付宝入账）
  CONSUME      // 消费（订阅员工、算力消耗）
  REFUND       // 退款（解雇员工、取消订阅）
  ADJUSTMENT   // 调整（管理员手动调整）
  FREEZE       // 冻结（预留）
  UNFREEZE     // 解冻（预留）
}
```

**关键字段说明**：
- `amount`：正数表示入账（充值、退款），负数表示出账（消费）
- `balanceBefore/After`：交易前后余额快照，用于审计对账
- `relatedType/Id`：关联业务实体，可追溯每笔钱的去向

---

### 2.3 PaymentOrder（支付订单）

```prisma
model PaymentOrder {
  id            String   @id @default(cuid())
  enterpriseId  String
  
  // 订单号
  orderNo       String   @unique  // 平台订单号（自己生成）
  tradeNo       String?  @unique  // 支付宝交易号（回调时填充）
  
  // 金额和状态
  amount        Decimal  @db.Decimal(10, 2)
  status        PaymentStatus
  method        PaymentMethod  // 'alipay', 'wechat'
  
  // 业务类型
  businessType  String   // 'recharge'（纯充值）, 'subscription'（订阅支付）
  relatedId     String?  // 如果是订阅支付，关联订阅 ID
  
  // 支付宝回调数据
  notifyData    Json?
  notifyTime    DateTime?
  
  // 时间戳
  createdAt     DateTime @default(now())
  paidAt        DateTime?
  closedAt      DateTime?
  
  enterprise    Enterprise @relation(fields: [enterpriseId], references: [id])
  
  @@index([enterpriseId, createdAt(sort: Desc)])
  @@index([status, createdAt])
  @@map("payment_orders")
}

enum PaymentStatus {
  PENDING      // 待支付（已创建，等待支付宝回调）
  PAID         // 已支付（回调成功，已入账）
  FAILED       // 支付失败
  REFUNDING    // 退款中
  REFUNDED     // 已退款
  CLOSED       // 已关闭（超时未支付）
}

enum PaymentMethod {
  ALIPAY       // 支付宝
  WECHAT       // 微信支付
  BALANCE      // 余额支付（预留）
}
```

---

### 2.4 修改 Subscription 模型

```prisma
model Subscription {
  id              String   @id @default(cuid())
  enterpriseId    String
  employeeId      String
  
  // ... 现有字段 ...
  
  // 新增：钱包支付记录
  walletTransactionId String? @unique  // 关联扣款记录
  
  // 新增：终止信息
  terminatedAt    DateTime?
  terminatedBy    String?   // 操作人 userId
  terminatedReason String?  // 'trial_refund'（试用期退款）, 'user_cancel'（用户主动）
  refundAmount    Decimal?  @db.Decimal(10, 2)  // 退款金额
  refundTransactionId String? @unique  // 退款交易记录
  
  // ... 其他字段 ...
}
```

---

### 2.5 ComputeAccount 如何处理？

**方案：保留但改为"虚拟视图"**

```prisma
model ComputeAccount {
  id           String   @id @default(cuid())
  enterpriseId String   @unique
  
  // ⚠️ 废弃字段（保留兼容）
  balance      Float    @default(0)  // 不再使用，从 Wallet 读取
  
  // 保留这些统计字段
  totalDeposit  Float   @default(0)
  totalConsumed Float   @default(0)
  
  // ... 其他字段 ...
}
```

**读取时**：
```typescript
async getComputeBalance(enterpriseId: string) {
  const wallet = await this.prisma.enterpriseWallet.findUnique({
    where: { enterpriseId },
  });
  return wallet.balance;  // 从钱包读取统一余额
}
```

**写入时**：
```typescript
// 算力消费时，同时写两处：
// 1. Wallet 扣款（真实余额）
await walletService.consume(enterpriseId, cost, 'compute', sessionId);

// 2. ComputeTransaction 记录（统计和追踪）
await prisma.computeTransaction.create({
  data: {
    accountId: account.id,
    type: 'CONSUME',
    amount: -cost,
    // ...
  },
});
```

---

## 三、业务流程设计

### 3.1 充值流程

```
用户 → 点击"充值" → 输入金额 → 调用支付宝
  ↓
创建 PaymentOrder (status=PENDING)
  ↓
跳转支付宝支付页面
  ↓
用户完成支付 → 支付宝异步回调
  ↓
验证签名 → PaymentOrder.status = PAID
  ↓
钱包入账：
  - wallet.balance += amount
  - 创建 WalletTransaction (DEPOSIT)
```

**代码示例**：
```typescript
async deposit(enterpriseId: string, amount: number, paymentOrderId: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 获取钱包（行锁）
    const wallet = await tx.enterpriseWallet.findUnique({
      where: { enterpriseId },
    });
    
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;
    
    // 2. 更新余额（乐观锁）
    const updated = await tx.enterpriseWallet.updateMany({
      where: {
        enterpriseId,
        version: wallet.version,  // 乐观锁：只有版本号匹配才更新
      },
      data: {
        balance: balanceAfter,
        totalDeposit: { increment: amount },
        version: { increment: 1 },
      },
    });
    
    if (updated.count === 0) {
      throw new ConflictException('余额更新冲突，请重试');
    }
    
    // 3. 记录交易
    return tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: amount,
        balanceBefore,
        balanceAfter,
        paymentMethod: 'alipay',
        paymentOrderId,
        description: `充值 ¥${amount}`,
      },
    });
  });
}
```

---

### 3.2 订阅员工流程

```
用户 → 选择员工 → 点击"订阅"
  ↓
检查钱包余额 >= 订阅价格？
  ├─ 否 → 提示充值
  └─ 是 ↓
    扣款：wallet.balance -= price
      ↓
    创建 WalletTransaction (CONSUME, relatedType='subscription')
      ↓
    创建 Subscription
      ↓
    自动创建 KnowledgeGrant（授权给订阅者）
```

**代码示例**：
```typescript
async subscribe(userId: string, dto: SubscriptionCreateDto) {
  const ctx = await this.enterpriseContext.resolve(userId);
  const employee = await this.prisma.digitalEmployee.findUnique({
    where: { id: dto.employeeId },
  });
  
  // 月费价格
  const price = employee.price;
  
  return this.prisma.$transaction(async (tx) => {
    // 1. 检查并扣款
    const txn = await this.walletService.consume(
      ctx.enterpriseId,
      price,
      'subscription',
      null,  // 先占位，订阅创建后回填
    );
    
    // 2. 创建订阅
    const subscription = await tx.subscription.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        employeeId: dto.employeeId,
        subscribedBy: userId,
        templateVersion: employee.version,
        price: price,
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: addMonths(new Date(), 1),
        walletTransactionId: txn.id,  // 关联扣款记录
      },
    });
    
    // 3. 回填 relatedId
    await tx.walletTransaction.update({
      where: { id: txn.id },
      data: { 
        relatedId: subscription.id,
        description: `订阅【${employee.name}】`,
      },
    });
    
    // 4. 自动授权给订阅者
    await tx.knowledgeGrant.create({
      data: {
        subscriptionId: subscription.id,
        granteeId: userId,
        grantedBy: userId,
        startDate: new Date(),
        endDate: addMonths(new Date(), 1),
      },
    });
    
    return subscription;
  });
}
```

---

### 3.3 算力消费流程

```
员工调用模型 → 计算消耗（tokens × 单价）
  ↓
扣款：wallet.balance -= cost
  ↓
创建 WalletTransaction (CONSUME, relatedType='compute')
  ↓
同时创建 ComputeTransaction（统计用）
```

**代码示例**：
```typescript
async recordCompute(enterpriseId: string, cost: number, metadata: any) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 从钱包扣款
    const walletTxn = await this.walletService.consume(
      enterpriseId,
      cost,
      'compute',
      metadata.sessionId,
    );
    
    // 2. 记录算力消费（保留，用于统计）
    const account = await tx.computeAccount.findUnique({
      where: { enterpriseId },
    });
    
    await tx.computeTransaction.create({
      data: {
        accountId: account.id,
        type: 'CONSUME',
        amount: -cost,
        metadata: {
          ...metadata,
          walletTransactionId: walletTxn.id,
        },
      },
    });
  });
}
```

---

### 3.4 解雇退款流程

```
管理员 → 解雇员工 → 判断是否在试用期内？
  ├─ 是（7天内）→ 全额退款
  │   ↓
  │   wallet.balance += original_price
  │   ↓
  │   WalletTransaction (REFUND, amount=original_price)
  │   ↓
  │   Subscription.status = TERMINATED
  │
  └─ 否（7天后）→ 不退款
      ↓
      Subscription.status = TERMINATED
```

**代码示例**：
```typescript
async terminate(subscriptionId: string, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { employee: true },
    });
    
    // 计算是否在试用期
    const daysSinceSubscribed = differenceInDays(new Date(), sub.createdAt);
    const isWithinTrial = daysSinceSubscribed <= 7;
    
    let refundAmount = 0;
    let refundTxnId = null;
    
    if (isWithinTrial) {
      // 全额退款
      refundAmount = sub.price;
      
      const refundTxn = await this.walletService.refund(
        sub.enterpriseId,
        refundAmount,
        'subscription',
        sub.id,
      );
      
      refundTxnId = refundTxn.id;
    }
    
    // 标记订阅已终止
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'TERMINATED',
        terminatedAt: new Date(),
        terminatedBy: userId,
        terminatedReason: isWithinTrial ? 'trial_refund' : 'user_cancel',
        refundAmount: refundAmount,
        refundTransactionId: refundTxnId,
      },
    });
    
    return { refunded: isWithinTrial, amount: refundAmount };
  });
}
```

---

## 四、并发安全设计

### 4.1 乐观锁机制

```typescript
// 每次更新钱包余额时，检查 version
const updated = await tx.enterpriseWallet.updateMany({
  where: {
    enterpriseId,
    version: currentVersion,  // 只有版本号匹配才更新
  },
  data: {
    balance: newBalance,
    version: { increment: 1 },  // 版本号 +1
  },
});

if (updated.count === 0) {
  throw new ConflictException('余额更新冲突，请重试');
}
```

### 4.2 数据库事务

所有涉及钱包余额变动的操作都必须在事务中完成：
```typescript
this.prisma.$transaction(async (tx) => {
  // 1. 读取余额
  // 2. 检查余额
  // 3. 更新余额
  // 4. 记录交易
});
```

### 4.3 余额快照审计

每笔交易记录 `balanceBefore` 和 `balanceAfter`：
```typescript
{
  balanceBefore: 1000.00,
  amount: -50.00,
  balanceAfter: 950.00,
}
```

可用于对账：
```sql
-- 验证交易链是否连续
SELECT 
  id,
  balance_before,
  amount,
  balance_after,
  LAG(balance_after) OVER (ORDER BY created_at) AS prev_balance_after
FROM wallet_transactions
WHERE wallet_id = 'xxx'
-- 检查：prev_balance_after 应该等于 balance_before
```

---

## 五、迁移策略

### 5.1 数据迁移脚本

```typescript
// scripts/migrate-to-wallet.ts
async function migrateToWallet() {
  const enterprises = await prisma.enterprise.findMany({
    include: { computeAccount: true },
  });
  
  for (const enterprise of enterprises) {
    // 1. 创建钱包
    const wallet = await prisma.enterpriseWallet.create({
      data: {
        enterpriseId: enterprise.id,
        balance: enterprise.computeAccount?.balance || 0,
        totalDeposit: enterprise.computeAccount?.totalDeposit || 0,
        totalConsume: enterprise.computeAccount?.totalConsumed || 0,
      },
    });
    
    // 2. 不迁移历史 ComputeTransaction
    //   （保留在原表，Dashboard 统计时合并查询）
    
    console.log(`✅ Migrated ${enterprise.name}: ¥${wallet.balance}`);
  }
}
```

### 5.2 灰度切换

**阶段1：双写**
```typescript
// 新订阅：从钱包扣款，同时记录到旧 ComputeAccount
await walletService.consume(enterpriseId, price, 'subscription', subId);
await computeAccount.update({ balance: { decrement: price } });  // 兼容旧逻辑
```

**阶段2：读写分离**
```typescript
// 写：只写 Wallet
// 读：优先读 Wallet，fallback 到 ComputeAccount
```

**阶段3：完全切换**
```typescript
// 停止写 ComputeAccount.balance
// ComputeAccount 只保留统计字段
```

---

## 六、前端展示

### 6.1 统一余额显示

```tsx
// Dashboard 顶部
<Card>
  <CardHeader>
    <CardTitle>企业钱包</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="text-3xl font-bold">¥{wallet.balance}</div>
    <div className="text-sm text-muted-foreground">
      可用余额 · 冻结 ¥{wallet.frozenAmount}
    </div>
    <Button onClick={() => router.push('/recharge')}>充值</Button>
  </CardContent>
</Card>
```

### 6.2 账单明细

```tsx
// /wallet/transactions
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>时间</TableHead>
      <TableHead>类型</TableHead>
      <TableHead>描述</TableHead>
      <TableHead className="text-right">金额</TableHead>
      <TableHead className="text-right">余额</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {transactions.map(txn => (
      <TableRow key={txn.id}>
        <TableCell>{format(txn.createdAt, 'yyyy-MM-dd HH:mm')}</TableCell>
        <TableCell>
          <Badge variant={txn.type === 'DEPOSIT' ? 'success' : 'secondary'}>
            {txn.type}
          </Badge>
        </TableCell>
        <TableCell>{txn.description}</TableCell>
        <TableCell className={`text-right ${txn.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
          {txn.amount > 0 ? '+' : ''}{txn.amount}
        </TableCell>
        <TableCell className="text-right">{txn.balanceAfter}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

---

## 七、API 设计

### 7.1 钱包相关

```typescript
// GET /api/wallet
// 获取钱包余额
{
  balance: 1234.56,
  frozenAmount: 0,
  totalDeposit: 5000.00,
  totalConsume: 3765.44,
  totalRefund: 0
}

// GET /api/wallet/transactions?page=1&limit=20&type=DEPOSIT
// 获取交易记录
{
  items: [
    {
      id: 'txn_xxx',
      type: 'DEPOSIT',
      amount: 500.00,
      balanceBefore: 734.56,
      balanceAfter: 1234.56,
      description: '充值 ¥500',
      createdAt: '2026-08-14T10:30:00Z'
    },
    // ...
  ],
  total: 156,
  page: 1,
  limit: 20
}

// POST /api/wallet/recharge
// 发起充值
{
  amount: 500.00
}
→ 返回支付宝支付链接

// POST /api/wallet/adjust (管理员)
// 手动调整余额（补偿、赠送等）
{
  enterpriseId: 'ent_xxx',
  amount: 100.00,
  reason: '新用户赠送'
}
```

### 7.2 订阅相关

```typescript
// POST /api/subscriptions
// 订阅员工（从钱包扣款）
{
  employeeId: 'emp_xxx'
}
→ 自动从钱包扣款，无需跳转支付

// DELETE /api/subscriptions/:id
// 解雇员工（试用期内退款到钱包）
→ 返回 { refunded: true, amount: 50.00 }
```

---

## 八、优势总结

### 相比现状的改进

| 维度 | 现状（分离） | 统一钱包 |
|-----|------------|---------|
| **用户体验** | 算力和订阅分开付费 | 一次充值，随处使用 |
| **退款灵活性** | 订阅退款需原路退回支付宝 | 退款到钱包，可继续使用 |
| **支付成本** | 每次订阅都调用支付宝 | 预充值，减少手续费 |
| **账单清晰度** | 两套账单系统 | 统一交易记录 |
| **企业采购** | 不支持批量采购 | 可预充值企业套餐 |
| **财务对账** | 需对两个账户 | 单一账户，对账简单 |

### 长期价值

1. **支持企业套餐**："充 ¥10000 送 ¥1000"
2. **支持发票管理**：统一开票，不用每次订阅都开
3. **支持信用额度**：大客户可以先用后付
4. **支持多币种**：国际化扩展基础
5. **支持分润**：能力贡献者分成从钱包扣
6. **支持转账**：企业间可以互相转钱包余额（高级功能）

---

## 九、实施步骤

### Phase 1: 数据库层（1周）
- [ ] 添加 Prisma Schema
- [ ] 生成并运行迁移
- [ ] 数据迁移脚本（ComputeAccount → Wallet）

### Phase 2: 服务层（1周）
- [ ] WalletService 实现
- [ ] 修改 SubscriptionService（从钱包扣款）
- [ ] 修改算力消费逻辑
- [ ] 解雇退款逻辑

### Phase 3: API 层（3天）
- [ ] Wallet Controller
- [ ] 修改 Subscription API
- [ ] 支付回调处理

### Phase 4: 前端（1周）
- [ ] 钱包余额显示
- [ ] 充值页面
- [ ] 账单明细页
- [ ] 订阅流程调整

### Phase 5: 测试（3天）
- [ ] 单元测试
- [ ] 并发测试
- [ ] 支付流程测试
- [ ] 退款流程测试

**总计：约 3 周**

---

## 十、风险和注意事项

### 10.1 数据一致性
- ⚠️ 钱包余额是核心，必须严格事务保护
- ⚠️ 迁移时必须备份数据
- ⚠️ 上线后需要定期对账脚本

### 10.2 并发控制
- ⚠️ 高并发场景下乐观锁失败率
- ⚠️ 需要监控锁冲突率
- ⚠️ 考虑引入 Redis 分布式锁

### 10.3 财务合规
- ⚠️ 钱包余额涉及真实资金，需要财务审计
- ⚠️ 退款需要留痕，可追溯
- ⚠️ 需要定期生成对账报表

### 10.4 安全性
- ⚠️ 管理员调整余额需要审批流程
- ⚠️ 支付回调需要验签
- ⚠️ 敏感操作需要二次验证

---

## 十一、后续扩展

### 11.1 信用额度（Credit Line）
```prisma
model EnterpriseWallet {
  // ... 现有字段 ...
  creditLimit  Decimal @default(0) @db.Decimal(10, 2)  // 信用额度
  creditUsed   Decimal @default(0) @db.Decimal(10, 2)  // 已用信用
}
```

大客户可以先消费，月底统一结算。

### 11.2 多币种支持
```prisma
model EnterpriseWallet {
  currency     String  @default("CNY")  // CNY, USD, EUR
  // ...
}
```

### 11.3 分润系统
能力贡献者发布员工，每次使用分成 20%：
```typescript
// 算力消费时
await walletService.consume(enterpriseId, 1.00, 'compute', sessionId);
await walletService.deposit(contributorEnterpriseId, 0.20, 'revenue_share');
```

---

## 结论

统一钱包是一个复杂但值得的架构升级，它为平台的长期发展奠定了基础。虽然初期实施成本较高（约3周），但带来的用户体验提升和业务灵活性是巨大的。

建议按照 Phase 1-5 逐步推进，每个阶段都充分测试后再进入下一阶段。
